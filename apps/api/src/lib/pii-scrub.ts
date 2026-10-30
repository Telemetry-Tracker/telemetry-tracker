/**
 * Shared PII scrubbing for ingest (write path) and brief snapshots (read path).
 * Prefer stable placeholders over a generic [REDACTED] so debugging context remains useful.
 */

export type PiiScrubOptions = {
  /** Max object/array nesting depth (default 8). */
  maxDepth?: number;
  /**
   * Soft threshold: when exceeded, switch to the bounded remainder pass
   * (still redacts nested keys/strings). Default 500.
   */
  maxNodes?: number;
  /**
   * Extra property keys to redact (case-insensitive; `_`/`-` ignored).
   * Values become `[redacted]` unless the key already has a built-in placeholder.
   */
  denyKeys?: string[];
};

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 500;

const EMAIL_RE = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}\b/gi;
const API_KEY_RE =
  /\b(?:tt_(?:live|read)_[A-Za-z0-9_]+|sk-[A-Za-z0-9]{16,}|pk-[A-Za-z0-9]{16,})\b/g;
const SENSITIVE_PARAM_RE =
  /([?&](?:password|token|secret|api[_-]?key|access[_-]?token|auth|session|cookie)=)[^&\s]+/gi;
const SENSITIVE_ASSIGNMENT_RE =
  /\b(?:password|token|secret|api[_-]?key|access[_-]?token|auth|session|cookie)\s*=\s*[^\s&]+/gi;
const COOKIE_HEADER_RE = /\b(cookie|set-cookie)\s*:\s*[^\n]+/gi;
const AUTHORIZATION_HEADER_RE = /\bauthorization\s*:\s*[^\n]+/gi;
const SENSITIVE_UUID_CONTEXT_RE =
  /\b(?:user[_-]?id|anonymous[_-]?id|session[_-]?id|customer[_-]?id|account[_-]?id)\s*[=:]\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Normalized key (lowercase, non-alphanumerics stripped) → placeholder. */
const SENSITIVE_KEY_PLACEHOLDERS: Readonly<Record<string, string>> = {
  email: "[email]",
  useremail: "[email]",
  mail: "[email]",
  phone: "[phone]",
  phonenumber: "[phone]",
  mobile: "[phone]",
  cellphone: "[phone]",
  ssn: "[ssn]",
  password: "[password]",
  passwd: "[password]",
  secret: "[secret]",
  token: "[token]",
  accesstoken: "[token]",
  refreshtoken: "[token]",
  idtoken: "[token]",
  apikey: "[api-key]",
  apisecret: "[api-key]",
  authorization: "[bearer-token]",
  auth: "[token]",
  cookie: "[cookie]",
  setcookie: "[cookie]",
  creditcard: "[card]",
  cardnumber: "[card]",
  cvv: "[card]",
  cvc: "[card]",
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolvePlaceholder(
  key: string,
  denyNormalized: ReadonlySet<string>
): string | null {
  const n = normalizeKey(key);
  const mapped = SENSITIVE_KEY_PLACEHOLDERS[n];
  if (mapped) return mapped;
  if (denyNormalized.has(n)) return "[redacted]";
  return null;
}

function denyKeySet(denyKeys: string[] | undefined): ReadonlySet<string> {
  if (!denyKeys || denyKeys.length === 0) return EMPTY_DENY;
  const set = new Set<string>();
  for (const key of denyKeys) {
    const n = normalizeKey(key);
    if (n) set.add(n);
  }
  return set;
}

const EMPTY_DENY: ReadonlySet<string> = new Set();

function replaceSensitiveUuidContexts(text: string): string {
  const uuidMap = new Map<string, string>();
  let counter = 0;

  return text.replace(SENSITIVE_UUID_CONTEXT_RE, (match) => {
    if (!uuidMap.has(match)) {
      counter += 1;
      uuidMap.set(match, `[id:${counter}]`);
    }
    return uuidMap.get(match)!;
  });
}

function stripUrlQueryStrings(text: string): string {
  return text.replace(/https?:\/\/[^\s?]+(\?[^\s]+)/gi, (match, queryPart: string) => {
    if (/[?&](?:password|token|secret|key|auth)=/i.test(queryPart)) {
      return match.slice(0, match.length - queryPart.length);
    }
    return match.replace(/\?[^#\s]+/, "");
  });
}

/** Luhn check for payment-card digit strings (13–19 digits). */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Redact PAN-like sequences that pass Luhn.
 * Requires separators or a contiguous 13–19 digit run; bare short IDs are left alone.
 */
function scrubPaymentCardNumbers(text: string): string {
  return text.replace(
    /(?<![A-Za-z0-9])(?:\d[ -]*?){13,19}(?![A-Za-z0-9])/g,
    (match) => {
      const digits = match.replace(/\D/g, "");
      return passesLuhn(digits) ? "[card]" : match;
    }
  );
}

/**
 * Conservative phone heuristics — formatted / E.164 only.
 * Bare digit runs (order IDs, timestamps, ZIP codes) are intentionally not matched.
 */
function scrubPhoneNumbers(text: string): string {
  let out = text;
  // Plus-prefixed: + and 7–15 digits with optional spaces/dashes between digits
  // e.g. +15551234567, +1-202-555-0183, +386 40 123 456
  // Dots are intentionally excluded so version-like 123.456.7890 is not treated as a phone.
  out = out.replace(
    /(?<![\w])\+[1-9](?:[\s-]*\d){6,14}(?![\d])/g,
    "[phone]"
  );
  // North American style with separators (space/dash only; no dots):
  // (555) 123-4567 / 555-123-4567 / 1-555-123-4567
  out = out.replace(
    /(?<![\w])(?:\+?1[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}(?![\d])/g,
    "[phone]"
  );
  return out;
}

/**
 * Scrub PII patterns in free-form text.
 * Preserves newlines (important for stack traces). Does not collapse whitespace.
 */
export function scrubPiiText(text: string): string {
  let out = text;
  out = out.replace(EMAIL_RE, "[email]");
  out = out.replace(JWT_RE, "[token]");
  out = out.replace(BEARER_RE, "[bearer-token]");
  out = out.replace(API_KEY_RE, "[api-key]");
  out = scrubPaymentCardNumbers(out);
  out = scrubPhoneNumbers(out);
  out = out.replace(SENSITIVE_PARAM_RE, "$1[redacted]");
  out = out.replace(
    SENSITIVE_ASSIGNMENT_RE,
    (match) => `${match.split("=")[0]!.trim()}=[redacted]`
  );
  out = out.replace(COOKIE_HEADER_RE, (_, header: string) => `${header}: [cookie]`);
  out = out.replace(
    AUTHORIZATION_HEADER_RE,
    "authorization: [bearer-token]"
  );
  out = stripUrlQueryStrings(out);
  out = replaceSensitiveUuidContexts(out);
  return out;
}

/**
 * Recursively scrub JSON-like values: sensitive keys → placeholders;
 * other strings run through {@link scrubPiiText}.
 */
export function scrubPiiValue(value: unknown, options?: PiiScrubOptions): unknown {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;
  const denyNormalized = denyKeySet(options?.denyKeys);
  let nodes = 0;

  function scrubRemainder(node: unknown, hardCap: { n: number }): unknown {
    hardCap.n += 1;
    // Absolute ceiling so limit fallback cannot DoS the ingest process.
    if (hardCap.n > 10_000) {
      return typeof node === "string" ? scrubPiiText(node) : "[truncated]";
    }
    if (typeof node === "string") return scrubPiiText(node);
    if (Array.isArray(node)) {
      return node.map((item) => scrubRemainder(item, hardCap));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const placeholder = resolvePlaceholder(key, denyNormalized);
        if (placeholder != null) {
          out[key] = placeholder;
        } else {
          out[key] = scrubRemainder(child, hardCap);
        }
      }
      return out;
    }
    return node;
  }

  function walk(node: unknown, depth: number): unknown {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) {
      // Still redact nested strings/keys; do not throw or drop the request.
      return scrubRemainder(node, { n: 0 });
    }

    if (node == null || typeof node === "boolean" || typeof node === "number") {
      return node;
    }

    if (typeof node === "string") {
      return scrubPiiText(node);
    }

    if (Array.isArray(node)) {
      return node.map((item) => walk(item, depth + 1));
    }

    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const placeholder = resolvePlaceholder(key, denyNormalized);
        if (placeholder != null) {
          out[key] = placeholder;
          continue;
        }
        out[key] = walk(child, depth + 1);
      }
      return out;
    }

    return node;
  }

  return walk(value, 0);
}

export function scrubPiiRecord(
  record: Record<string, unknown> | undefined | null,
  options?: PiiScrubOptions
): Record<string, unknown> | undefined {
  if (record == null) return undefined;
  return scrubPiiValue(record, options) as Record<string, unknown>;
}
