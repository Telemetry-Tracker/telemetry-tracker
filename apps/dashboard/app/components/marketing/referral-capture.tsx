"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  promoteRememberedAffiliateReferralCookie,
  rememberAffiliateReferral,
  resolveReferralFromParams,
} from "@/lib/affiliate-referral";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  preferenceCookiesAllowed,
  readStoredCookieConsentChoice,
  type CookieConsentChoice,
} from "@/lib/cookie-consent";

/**
 * Last-touch capture for `?ref=` / `?via=`.
 * Always writes sessionStorage. Optional cookie only after marketing consent.
 */
export function ReferralCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AFFILIATES_ENABLED !== "true") return;
    const code = resolveReferralFromParams(searchParams);
    if (code) rememberAffiliateReferral(code);
  }, [searchParams]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AFFILIATES_ENABLED !== "true") return;
    const persistCookieIfConsented = (choice: CookieConsentChoice | null) => {
      if (!preferenceCookiesAllowed(choice)) return;
      const fromUrl = resolveReferralFromParams(searchParams);
      if (fromUrl) {
        rememberAffiliateReferral(fromUrl);
        return;
      }
      promoteRememberedAffiliateReferralCookie(choice);
    };
    persistCookieIfConsented(readStoredCookieConsentChoice());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<CookieConsentChoice>).detail;
      persistCookieIfConsented(detail);
    };
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChange);
  }, [searchParams]);

  return null;
}
