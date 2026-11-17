/**
 * QA / probe visits (same rules as tacko.io `isQaVisit`): `?qa=1`, `utm_source=qa…`, or a `TackoQA` user agent.
 * Remembered with a first-party `qa=1` cookie (30 days) and for the tab, so all hits get `traffic_type=internal`.
 * Client-only; called only after analytics consent (from GoogleAnalytics).
 */
export const QA_COOKIE_NAME = "qa";
export const QA_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const QA_SESSION_KEY = "tt-qa";
const HOSTED_DOMAIN = "telemetry-tracker.com";

export function isQaSignal(search: string, userAgent: string): boolean {
  const p = new URLSearchParams(search);
  return /TackoQA/.test(userAgent) || p.get("qa") === "1" || /^qa(_|$)/.test(p.get("utm_source") || "");
}

export function qaCookieString(hostname: string, protocol: string): string {
  const secure = protocol === "https:" ? "; Secure" : "";
  const domain =
    hostname === HOSTED_DOMAIN || hostname.endsWith(`.${HOSTED_DOMAIN}`) ? `; Domain=.${HOSTED_DOMAIN}` : "";
  return `${QA_COOKIE_NAME}=1; Max-Age=${QA_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}${domain}`;
}

/**
 * QA signal seen when the app loaded, kept in memory only (nothing is stored before consent). If the visitor
 * rejects first and accepts later, ?qa=1 may already be gone from the URL after client navigation; this keeps
 * the hits internal and the flag is persisted only then, from isQaVisit() after consent.
 */
const qaAtLoad = typeof window !== "undefined" && isQaSignal(window.location.search, navigator.userAgent);

export function isQaVisit(): boolean {
  if (typeof window === "undefined") return false;
  const qa = qaAtLoad || isQaSignal(window.location.search, navigator.userAgent);
  if (qa) {
    try {
      document.cookie = qaCookieString(window.location.hostname, window.location.protocol);
    } catch {
      /* ignore */
    }
  }
  const cookie = /(?:^|;\s*)(?:qa|tacko_qa)=1(?:;|$)/.test(document.cookie);
  try {
    if (qa || cookie) sessionStorage.setItem(QA_SESSION_KEY, "1");
    return qa || cookie || sessionStorage.getItem(QA_SESSION_KEY) === "1";
  } catch {
    return qa || cookie;
  }
}

/** Withdrawal: forget the tab-level QA flag (the `qa` cookie is deleted with the GA cookies). */
export function clearQaVisitFlag(): void {
  try {
    sessionStorage.removeItem(QA_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Extra GA4 params for QA visits; spread into `config` and every event. */
export function qaTrafficParams(): { traffic_type?: "internal" } {
  return isQaVisit() ? { traffic_type: "internal" } : {};
}
