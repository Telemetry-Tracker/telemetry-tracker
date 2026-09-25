import { describe, expect, it } from "vitest";
import {
  readCookieConsentChoiceFromCookieHeader,
  COOKIE_CONSENT_STORAGE_KEY,
  preferenceCookiesAllowed,
  workspaceCookiesDependOnConsent,
} from "./cookie-consent";

describe("workspace cookies vs optional consent", () => {
  it("keeps project selection when optional cookies are rejected", () => {
    expect(preferenceCookiesAllowed("rejected")).toBe(false);
    expect(preferenceCookiesAllowed(null)).toBe(false);
    expect(workspaceCookiesDependOnConsent("rejected")).toBe(false);
    expect(workspaceCookiesDependOnConsent("accepted")).toBe(false);
    expect(workspaceCookiesDependOnConsent(null)).toBe(false);
  });
});

describe("readCookieConsentChoiceFromCookieHeader", () => {
  it("reads the consent cookie among other cookies", () => {
    expect(
      readCookieConsentChoiceFromCookieHeader(
        `theme=dark; ${COOKIE_CONSENT_STORAGE_KEY}=accepted; other=1`
      )
    ).toBe("accepted");
  });

  it("returns rejected", () => {
    expect(
      readCookieConsentChoiceFromCookieHeader(`${COOKIE_CONSENT_STORAGE_KEY}=rejected`)
    ).toBe("rejected");
  });

  it("returns null for missing or invalid values", () => {
    expect(readCookieConsentChoiceFromCookieHeader("")).toBeNull();
    expect(readCookieConsentChoiceFromCookieHeader("foo=bar")).toBeNull();
    expect(
      readCookieConsentChoiceFromCookieHeader(`${COOKIE_CONSENT_STORAGE_KEY}=maybe`)
    ).toBeNull();
  });
});
