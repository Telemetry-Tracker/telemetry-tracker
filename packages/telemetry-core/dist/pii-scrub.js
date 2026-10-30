/**
 * Optional client-side PII scrubbing for @telemetry-tracker/core.
 * Complements server ingest scrubbing; never replaces it.
 */
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 500;
const EMAIL_RE = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}\b/gi;
const API_KEY_RE = /\b(?:tt_live_[A-Za-z0-9_]+|sk-[A-Za-z0-9]{16,}|pk-[A-Za-z0-9]{16,})\b/g;
const SENSITIVE_PARAM_RE = /([?&](?:password|token|secret|api[_-]?key|access[_-]?token|auth|session|cookie)=)[^&\s]+/gi;
const SENSITIVE_ASSIGNMENT_RE = /\b(?:password|token|secret|api[_-]?key|access[_-]?token|auth|session|cookie)\s*=\s*[^\s&]+/gi;
const COOKIE_HEADER_RE = /\b(cookie|set-cookie)\s*:\s*[^\n]+/gi;
const AUTHORIZATION_HEADER_RE = /\bauthorization\s*:\s*[^\n]+/gi;
const SENSITIVE_KEY_PLACEHOLDERS = {
    email: "[email]",
    useremail: "[email]",
    mail: "[email]",
    phone: "[phone]",
    phonenumber: "[phone]",
    mobile: "[phone]",
    ssn: "[ssn]",
    password: "[password]",
    secret: "[secret]",
    token: "[token]",
    accesstoken: "[token]",
    refreshtoken: "[token]",
    apikey: "[api-key]",
    authorization: "[bearer-token]",
    cookie: "[cookie]",
    setcookie: "[cookie]",
};
function normalizeKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function denyKeySet(denyKeys) {
    if (!denyKeys?.length)
        return EMPTY;
    const set = new Set();
    for (const key of denyKeys) {
        const n = normalizeKey(key);
        if (n)
            set.add(n);
    }
    return set;
}
const EMPTY = new Set();
function resolvePlaceholder(key, denyNormalized) {
    const n = normalizeKey(key);
    return SENSITIVE_KEY_PLACEHOLDERS[n] ?? (denyNormalized.has(n) ? "[redacted]" : null);
}
/** Scrub PII patterns in free-form text. Preserves newlines. */
export function scrubPiiText(text) {
    let out = text;
    out = out.replace(EMAIL_RE, "[email]");
    out = out.replace(JWT_RE, "[token]");
    out = out.replace(BEARER_RE, "[bearer-token]");
    out = out.replace(API_KEY_RE, "[api-key]");
    out = scrubPaymentCardNumbers(out);
    out = scrubPhoneNumbers(out);
    out = out.replace(SENSITIVE_PARAM_RE, "$1[redacted]");
    out = out.replace(SENSITIVE_ASSIGNMENT_RE, (match) => `${match.split("=")[0].trim()}=[redacted]`);
    out = out.replace(COOKIE_HEADER_RE, (_, header) => `${header}: [cookie]`);
    out = out.replace(AUTHORIZATION_HEADER_RE, "authorization: [bearer-token]");
    return out;
}
function passesLuhn(digits) {
    if (!/^\d{13,19}$/.test(digits))
        return false;
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = digits.charCodeAt(i) - 48;
        if (alternate) {
            n *= 2;
            if (n > 9)
                n -= 9;
        }
        sum += n;
        alternate = !alternate;
    }
    return sum % 10 === 0;
}
function scrubPaymentCardNumbers(text) {
    return text.replace(/(?<![A-Za-z0-9])(?:\d[ -]*?){13,19}(?![A-Za-z0-9])/g, (match) => {
        const digits = match.replace(/\D/g, "");
        return passesLuhn(digits) ? "[card]" : match;
    });
}
function scrubPhoneNumbers(text) {
    let out = text;
    // Plus-prefixed: + and 7–15 digits with optional spaces/dashes between digits
    // Dots excluded so version-like 123.456.7890 is not treated as a phone.
    out = out.replace(/(?<![\w])\+[1-9](?:[\s-]*\d){6,14}(?![\d])/g, "[phone]");
    // North American style with separators (space/dash only; no dots)
    out = out.replace(/(?<![\w])(?:\+?1[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}(?![\d])/g, "[phone]");
    return out;
}
export function scrubPiiValue(value, options) {
    const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;
    const denyNormalized = denyKeySet(options?.denyKeys);
    let nodes = 0;
    /** Bounded recursive pass after soft limits — never returns nested structures unchanged. */
    function scrubRemainder(node, hardCap) {
        hardCap.n += 1;
        // Absolute ceiling so limit fallback cannot hang the client.
        if (hardCap.n > 10000) {
            return typeof node === "string" ? scrubPiiText(node) : "[truncated]";
        }
        if (typeof node === "string")
            return scrubPiiText(node);
        if (Array.isArray(node)) {
            return node.map((item) => scrubRemainder(item, hardCap));
        }
        if (node && typeof node === "object") {
            const out = {};
            for (const [key, child] of Object.entries(node)) {
                const placeholder = resolvePlaceholder(key, denyNormalized);
                out[key] =
                    placeholder != null ? placeholder : scrubRemainder(child, hardCap);
            }
            return out;
        }
        return node;
    }
    function walk(node, depth) {
        nodes += 1;
        if (nodes > maxNodes || depth > maxDepth) {
            return scrubRemainder(node, { n: 0 });
        }
        if (node == null || typeof node === "boolean" || typeof node === "number") {
            return node;
        }
        if (typeof node === "string")
            return scrubPiiText(node);
        if (Array.isArray(node))
            return node.map((item) => walk(item, depth + 1));
        if (typeof node === "object") {
            const out = {};
            for (const [key, child] of Object.entries(node)) {
                const placeholder = resolvePlaceholder(key, denyNormalized);
                out[key] =
                    placeholder != null ? placeholder : walk(child, depth + 1);
            }
            return out;
        }
        return node;
    }
    return walk(value, 0);
}
export function scrubPiiRecord(record, options) {
    if (record == null)
        return undefined;
    return scrubPiiValue(record, options);
}
