export const COOKIE_CONSENT_STORAGE_KEY = "tt-cookie-consent";

export const COOKIE_CONSENT_CHANGED_EVENT = "tt-cookie-consent-changed";

export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type CookieConsentChoice = "accepted" | "rejected";

export function isCookieConsentChoice(
  value: string | null | undefined
): value is CookieConsentChoice {
  return value === "accepted" || value === "rejected";
}

export function preferenceCookiesAllowed(
  choice: CookieConsentChoice | null | undefined
): boolean {
  return choice === "accepted";
}

/**
 * Selected organization and project are required for dashboard API calls.
 * Rejecting optional analytics cookies must not drop that context.
 */
export function workspaceCookiesDependOnConsent(
  _choice: CookieConsentChoice | null | undefined
): boolean {
  return false;
}

export function cookieConsentDocumentCookie(choice: CookieConsentChoice): string {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  return `${COOKIE_CONSENT_STORAGE_KEY}=${choice}; Path=/; Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/** Parse `tt-cookie-consent` from a Cookie header / `document.cookie` string. */
export function readCookieConsentChoiceFromCookieHeader(
  cookieHeader: string | null | undefined
): CookieConsentChoice | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== COOKIE_CONSENT_STORAGE_KEY) continue;
    const value = trimmed.slice(eq + 1).trim();
    return isCookieConsentChoice(value) ? value : null;
  }
  return null;
}

/** Client-only: localStorage, then the readable consent cookie. */
export function readStoredCookieConsentChoice(): CookieConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const localValue = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (isCookieConsentChoice(localValue)) return localValue;
  } catch {
    /* ignore */
  }
  return readCookieConsentChoiceFromCookieHeader(document.cookie);
}

export const PREFERENCE_COOKIES_REQUIRED_MSG =
  "Accept cookies in the banner to enable optional analytics.";

export const PREFERENCE_COOKIES_REJECTED_MSG =
  "Optional analytics cookies are off. Your selected organization and project are still saved.";
