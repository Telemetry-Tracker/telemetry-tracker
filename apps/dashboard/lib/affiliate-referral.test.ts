import { afterEach, describe, expect, it } from "vitest";
import {
  AFFILIATE_REFERRAL_STORAGE_KEY,
  parsePublicAffiliateCode,
  promoteRememberedAffiliateReferralCookie,
  readRememberedAffiliateReferral,
  rememberAffiliateReferral,
  resolveReferralFromParams,
} from "./affiliate-referral";
import { COOKIE_CONSENT_STORAGE_KEY } from "./cookie-consent";

describe("affiliate-referral", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.cookie = `${AFFILIATE_REFERRAL_STORAGE_KEY}=; Path=/; Max-Age=0`;
    document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=; Path=/; Max-Age=0`;
  });

  it("parses public codes and rejects UUIDs", () => {
    expect(parsePublicAffiliateCode("Alice")).toBe("alice");
    expect(parsePublicAffiliateCode("00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(resolveReferralFromParams(new URLSearchParams("ref=bob"))).toBe("bob");
    expect(resolveReferralFromParams(new URLSearchParams("via=carol"))).toBe("carol");
  });

  it("stores last-touch in sessionStorage even without marketing consent", () => {
    rememberAffiliateReferral("alice");
    rememberAffiliateReferral("bob");
    expect(readRememberedAffiliateReferral()?.code).toBe("bob");
    expect(document.cookie.includes(AFFILIATE_REFERRAL_STORAGE_KEY)).toBe(false);
  });

  it("writes the 60-day cookie only after marketing consent", () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    rememberAffiliateReferral("alice");
    expect(document.cookie).toContain(AFFILIATE_REFERRAL_STORAGE_KEY);
  });

  it("promotes a sessionStorage referral into the cookie after later marketing consent", () => {
    rememberAffiliateReferral("alice");
    expect(document.cookie.includes(AFFILIATE_REFERRAL_STORAGE_KEY)).toBe(false);
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    expect(promoteRememberedAffiliateReferralCookie("accepted")?.code).toBe("alice");
    expect(document.cookie).toContain(AFFILIATE_REFERRAL_STORAGE_KEY);
  });
});
