/**
 * First-party last-touch referral storage.
 * sessionStorage always (same-session fallback without marketing cookies).
 * Optional 60-day cookie only after marketing/preference consent.
 */
import {
  preferenceCookiesAllowed,
  readStoredCookieConsentChoice,
} from "@/lib/cookie-consent";

export const AFFILIATE_REFERRAL_STORAGE_KEY = "tt_affiliate_ref";
export const AFFILIATE_REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

export type StoredAffiliateReferral = {
  code: string;
  capturedAt: string;
};

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePublicAffiliateCode(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!CODE_RE.test(trimmed) || UUID_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function parseStoredAffiliateReferral(raw: string | null | undefined): StoredAffiliateReferral | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAffiliateReferral>;
    const code = parsePublicAffiliateCode(parsed.code);
    const capturedAt = typeof parsed.capturedAt === "string" ? parsed.capturedAt : "";
    if (!code || !capturedAt || Number.isNaN(new Date(capturedAt).getTime())) return null;
    return { code, capturedAt };
  } catch {
    return null;
  }
}

function writeAffiliateReferralCookie(referral: StoredAffiliateReferral): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  const value = encodeURIComponent(JSON.stringify(referral));
  document.cookie = `${AFFILIATE_REFERRAL_STORAGE_KEY}=${value}; Path=/; Max-Age=${AFFILIATE_REFERRAL_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function readAffiliateReferralCookie(): StoredAffiliateReferral | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${AFFILIATE_REFERRAL_STORAGE_KEY}=`)) continue;
    const value = decodeURIComponent(trimmed.slice(AFFILIATE_REFERRAL_STORAGE_KEY.length + 1));
    return parseStoredAffiliateReferral(value);
  }
  return null;
}

export function rememberAffiliateReferral(codeRaw: string, capturedAt: Date = new Date()): StoredAffiliateReferral | null {
  const code = parsePublicAffiliateCode(codeRaw);
  if (!code || typeof window === "undefined") return null;
  const referral: StoredAffiliateReferral = {
    code,
    capturedAt: capturedAt.toISOString(),
  };
  try {
    window.sessionStorage.setItem(AFFILIATE_REFERRAL_STORAGE_KEY, JSON.stringify(referral));
  } catch {
    /* ignore quota / private mode */
  }
  if (preferenceCookiesAllowed(readStoredCookieConsentChoice())) {
    writeAffiliateReferralCookie(referral);
  }
  return referral;
}

export function readRememberedAffiliateReferral(): StoredAffiliateReferral | null {
  if (typeof window === "undefined") return null;
  let fromSession: StoredAffiliateReferral | null = null;
  try {
    fromSession = parseStoredAffiliateReferral(
      window.sessionStorage.getItem(AFFILIATE_REFERRAL_STORAGE_KEY)
    );
  } catch {
    fromSession = null;
  }
  const fromCookie = preferenceCookiesAllowed(readStoredCookieConsentChoice())
    ? readAffiliateReferralCookie()
    : null;
  if (fromSession && fromCookie) {
    return new Date(fromSession.capturedAt) >= new Date(fromCookie.capturedAt)
      ? fromSession
      : fromCookie;
  }
  return fromSession ?? fromCookie;
}

export function resolveReferralFromParams(
  searchParams: Pick<URLSearchParams, "get">
): string | null {
  return (
    parsePublicAffiliateCode(searchParams.get("ref")) ??
    parsePublicAffiliateCode(searchParams.get("via"))
  );
}
