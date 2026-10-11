"use client";
import { useEffect } from "react";
import { COOKIE_CONSENT_CHANGED_EVENT, readStoredCookieConsentChoice, type CookieConsentChoice } from "@/lib/cookie-consent";
import { ATTRIBUTION_FIELDS, attributionCookie, readSignupAttribution, sanitizeSignupAttribution } from "@/lib/signup-attribution";

export function SignupAttributionCapture() {
  useEffect(() => {
    // Keep the initial landing in memory only until the visitor accepts analytics.
    const params = new URLSearchParams(window.location.search);
    const landing = sanitizeSignupAttribution({
      ...Object.fromEntries(ATTRIBUTION_FIELDS.map(key => [key, params.get(key)])),
      referrer_host: document.referrer,
    });
    const sync = (choice: CookieConsentChoice | null) => {
      try {
        if (choice === "rejected") document.cookie = attributionCookie(null);
        if (choice === "accepted" && !readSignupAttribution()) document.cookie = attributionCookie(landing);
      } catch { /* storage failures never block registration */ }
    };
    sync(readStoredCookieConsentChoice());
    const onChange = (event: Event) => sync((event as CustomEvent<CookieConsentChoice>).detail);
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChange);
  }, []);
  return null;
}
