import { cookies } from "next/headers";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_MAX_AGE_SECONDS,
  PREFERENCE_COOKIES_REJECTED_MSG,
  PREFERENCE_COOKIES_REQUIRED_MSG,
  isCookieConsentChoice,
  preferenceCookiesAllowed,
  workspaceCookiesDependOnConsent,
  type CookieConsentChoice,
} from "@/lib/cookie-consent";
import { TELEMETRY_ORG_COOKIE } from "@/lib/dashboard-org";
import { TELEMETRY_PROJECT_COOKIE } from "@/lib/dashboard-project";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function readDashboardProjectCookieValue(): Promise<string | undefined> {
  const v = (await cookies()).get(TELEMETRY_PROJECT_COOKIE)?.value?.trim();
  if (v && UUID_RE.test(v)) return v.toLowerCase();
  return undefined;
}

async function readDashboardOrganizationCookieValue(): Promise<string | undefined> {
  const v = (await cookies()).get(TELEMETRY_ORG_COOKIE)?.value?.trim();
  if (v && UUID_RE.test(v)) return v.toLowerCase();
  return undefined;
}

export async function getCookieConsentChoiceFromCookies(): Promise<CookieConsentChoice | null> {
  const value = (await cookies()).get(COOKIE_CONSENT_STORAGE_KEY)?.value;
  return isCookieConsentChoice(value) ? value : null;
}

const consentCookieBase = {
  path: "/",
  sameSite: "lax" as const,
  maxAge: COOKIE_CONSENT_MAX_AGE_SECONDS,
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
};

export async function setCookieConsentChoice(choice: CookieConsentChoice): Promise<void> {
  (await cookies()).set(COOKIE_CONSENT_STORAGE_KEY, choice, consentCookieBase);
}

/** Fill in the consent cookie only when the server has no prior choice (e.g. localStorage ahead of banner sync). */
export async function restoreCookieConsentChoiceIfUnset(
  choice: CookieConsentChoice
): Promise<boolean> {
  if (await getCookieConsentChoiceFromCookies()) return false;
  await setCookieConsentChoice(choice);
  return true;
}

/** Apply consent from auth FormData when the server has no choice yet — never override an existing cookie. */
export async function applyCookieConsentFromForm(formData: FormData): Promise<void> {
  if (await getCookieConsentChoiceFromCookies()) return;
  const raw = String(formData.get("cookieConsent") ?? "").trim();
  if (isCookieConsentChoice(raw)) {
    await setCookieConsentChoice(raw);
  }
}

export async function preferenceCookiesAllowedFromCookies(): Promise<boolean> {
  return preferenceCookiesAllowed(await getCookieConsentChoiceFromCookies());
}

export async function preferenceCookiesDeniedMessage(): Promise<string> {
  const choice = await getCookieConsentChoiceFromCookies();
  if (choice === "rejected") return PREFERENCE_COOKIES_REJECTED_MSG;
  return PREFERENCE_COOKIES_REQUIRED_MSG;
}

export async function getAllowedDashboardProjectCookie(): Promise<string | undefined> {
  if (workspaceCookiesDependOnConsent(await getCookieConsentChoiceFromCookies())) {
    return undefined;
  }
  return readDashboardProjectCookieValue();
}

export async function getAllowedDashboardOrganizationCookie(): Promise<string | undefined> {
  if (workspaceCookiesDependOnConsent(await getCookieConsentChoiceFromCookies())) {
    return undefined;
  }
  return readDashboardOrganizationCookieValue();
}

/** Optional-consent rejection must not expire the workspace cookies the dashboard needs. */
export async function clearPreferenceCookies(): Promise<void> {
  return;
}
