import { readStoredCookieConsentChoice } from "@/lib/cookie-consent";

/** Called once after successful registration, before leaving the marketing route. */
export function trackSignup(): void {
  if (readStoredCookieConsentChoice() !== "accepted") return;
  window.gtag?.("event", "sign_up", { method: "email" });
}
