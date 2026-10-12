import { afterEach, describe, expect, it, vi } from "vitest";
import { trackSignup } from "./signup-analytics";
import { COOKIE_CONSENT_STORAGE_KEY } from "./cookie-consent";
afterEach(() => { localStorage.clear(); delete window.gtag; });
describe("GA4 signup consent", () => {
  it.each([null, "rejected", "accepted"])("gates sign_up for %s", choice => {
    const gtag = vi.fn();
    window.gtag = gtag;
    if (choice) localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
    trackSignup();
    expect(gtag).toHaveBeenCalledTimes(choice === "accepted" ? 1 : 0);
    if (choice === "accepted") expect(gtag).toHaveBeenCalledWith("event", "sign_up", { method: "email" });
  });
  it("does not load analytics when unavailable", () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    expect(() => trackSignup()).not.toThrow();
  });
});
