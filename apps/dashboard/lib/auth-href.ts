type AuthSearchParams = Pick<URLSearchParams, "get">;

export const DEFAULT_POST_LOGIN_PATH = "/dashboard/overview";

/**
 * Fixed origin used only to resolve relative `next` values. Protocol-relative
 * and absolute URLs change `url.origin` and are rejected.
 */
const POST_LOGIN_RESOLVE_ORIGIN = "https://telemetry-tracker.invalid";

/** Null bytes, C0 controls (incl. tab/CR/LF), DEL, and backslash host tricks. */
const UNSAFE_NEXT_CHARS = /[\u0000-\u001f\u007f\\]/;

/**
 * Decode percent-encoding until stable so encoded `/`, `\`, and controls cannot
 * bypass same-origin checks. Malformed or endlessly nested encodings → null.
 */
function fullyDecodeUriComponent(raw: string): string | null {
  let current = raw;
  for (let i = 0; i < 5; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Canonical post-login destination: same-origin relative path + query, or null.
 * Rejects protocol-relative hosts, backslashes, control characters (tab/CR/LF),
 * their percent-encoded forms, and absolute external URLs. Does not treat the
 * marketing homepage (`/`) as a post-login target.
 */
export function normalizePostLoginRedirectPath(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  const decoded = fullyDecodeUriComponent(raw);
  if (decoded == null) return null;

  // Reject before URL parsing so backslash / control-char / multi-slash tricks
  // never reach the parser's compatibility normalizations (which can reinterpret
  // them as a different host).
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;
  if (UNSAFE_NEXT_CHARS.test(decoded)) return null;

  let url: URL;
  try {
    url = new URL(decoded, POST_LOGIN_RESOLVE_ORIGIN);
  } catch {
    return null;
  }

  if (url.origin !== POST_LOGIN_RESOLVE_ORIGIN) return null;
  if (url.username || url.password) return null;
  // Path must stay a single-root relative path (no scheme smuggling via pathname).
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
  if (UNSAFE_NEXT_CHARS.test(url.pathname) || UNSAFE_NEXT_CHARS.test(url.search)) {
    return null;
  }

  const pathWithQuery = `${url.pathname}${url.search}`;
  if (pathWithQuery === "/" || url.pathname === "/") return null;

  return pathWithQuery;
}

/** Post-login destinations must be safe in-app paths, not the marketing homepage. */
export function isPostLoginRedirectPath(
  path: string | null | undefined
): path is string {
  return normalizePostLoginRedirectPath(path) != null;
}

export function resolvePostLoginPath(next: string | null | undefined): string {
  return normalizePostLoginRedirectPath(next) ?? DEFAULT_POST_LOGIN_PATH;
}

/** Split a resolved post-login href into pathname + search for NextResponse.redirect. */
export function postLoginRedirectParts(next: string | null | undefined): {
  pathname: string;
  search: string;
} {
  const resolved = resolvePostLoginPath(next);
  const q = resolved.indexOf("?");
  if (q === -1) return { pathname: resolved, search: "" };
  return { pathname: resolved.slice(0, q), search: resolved.slice(q) };
}

/** Preserve invite (and login `next`) when switching between auth pages. */
export function crossAuthHref(
  target: "/login" | "/register",
  searchParams: AuthSearchParams
): string {
  const params = new URLSearchParams();
  const invite = searchParams.get("invite")?.trim();
  if (invite) params.set("invite", invite);
  if (target === "/login") {
    const safeNext = normalizePostLoginRedirectPath(searchParams.get("next"));
    if (safeNext) params.set("next", safeNext);
  }
  const qs = params.toString();
  return qs ? `${target}?${qs}` : target;
}
