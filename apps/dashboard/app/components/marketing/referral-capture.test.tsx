import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralCapture } from "./referral-capture";
import {
  AFFILIATE_REFERRAL_STORAGE_KEY,
  readRememberedAffiliateReferral,
} from "@/lib/affiliate-referral";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  type CookieConsentChoice,
} from "@/lib/cookie-consent";

const searchParamsMock = vi.fn(() => new URLSearchParams("ref=alice"));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock(),
}));

describe("ReferralCapture", () => {
  const originalFlag = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.cookie = `${AFFILIATE_REFERRAL_STORAGE_KEY}=; Path=/; Max-Age=0`;
    document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=; Path=/; Max-Age=0`;
    searchParamsMock.mockReturnValue(new URLSearchParams("ref=alice"));
    delete process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;
  });

  afterEach(() => {
    cleanup();
    if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;
    else process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = originalFlag;
    document.querySelectorAll('script[src*="r.wdfl.co"]').forEach((node) => node.remove());
  });

  it("does not load any Rewardful script", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    const { unmount } = render(<ReferralCapture />);
    expect(document.querySelector('script[src*="r.wdfl.co"]')).toBeNull();
    unmount();
  });

  it("does not capture when the public flag is off", () => {
    const { unmount } = render(<ReferralCapture />);
    expect(window.sessionStorage.getItem(AFFILIATE_REFERRAL_STORAGE_KEY)).toBeNull();
    unmount();
  });

  it("stores last-touch in sessionStorage when the flag is on", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    const { unmount } = render(<ReferralCapture />);
    const stored = window.sessionStorage.getItem(AFFILIATE_REFERRAL_STORAGE_KEY);
    expect(stored).toContain("alice");
    unmount();
  });

  it("a second ?ref= visit replaces the earlier stored referral (last touch, session only)", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    searchParamsMock.mockReturnValue(new URLSearchParams("ref=alice"));
    const { rerender, unmount } = render(<ReferralCapture />);
    const first = JSON.parse(window.sessionStorage.getItem(AFFILIATE_REFERRAL_STORAGE_KEY)!);
    expect(first.code).toBe("alice");

    // Client-side navigation to another landing path with a different affiliate's link.
    searchParamsMock.mockReturnValue(new URLSearchParams("ref=Bob"));
    rerender(<ReferralCapture />);
    const second = JSON.parse(window.sessionStorage.getItem(AFFILIATE_REFERRAL_STORAGE_KEY)!);
    expect(second.code).toBe("bob");
    expect(new Date(second.capturedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.capturedAt).getTime()
    );
    expect(readRememberedAffiliateReferral()?.code).toBe("bob");
    // No consent → still no cookie.
    expect(document.cookie).not.toContain(AFFILIATE_REFERRAL_STORAGE_KEY);

    // Navigating on without ?ref= keeps the last touch.
    searchParamsMock.mockReturnValue(new URLSearchParams("utm_source=newsletter"));
    rerender(<ReferralCapture />);
    expect(readRememberedAffiliateReferral()?.code).toBe("bob");
    unmount();
  });

  it("a second ?ref= visit also replaces the 60-day cookie after consent (last touch)", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    searchParamsMock.mockReturnValue(new URLSearchParams("ref=alice"));
    const { rerender, unmount } = render(<ReferralCapture />);
    expect(decodeURIComponent(document.cookie)).toContain('"code":"alice"');

    searchParamsMock.mockReturnValue(new URLSearchParams("via=carol"));
    rerender(<ReferralCapture />);
    expect(decodeURIComponent(document.cookie)).toContain('"code":"carol"');
    expect(decodeURIComponent(document.cookie)).not.toContain('"code":"alice"');
    // A fresh session (sessionStorage cleared) still resolves the latest touch from the cookie.
    window.sessionStorage.clear();
    expect(readRememberedAffiliateReferral()?.code).toBe("carol");
    unmount();
  });

  it("promotes a sessionStorage referral into the cookie after consent without ?ref= in the URL", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    searchParamsMock.mockReturnValue(new URLSearchParams(""));
    window.sessionStorage.setItem(
      AFFILIATE_REFERRAL_STORAGE_KEY,
      JSON.stringify({ code: "alice", capturedAt: new Date().toISOString() })
    );
    const { unmount } = render(<ReferralCapture />);
    expect(document.cookie.includes(AFFILIATE_REFERRAL_STORAGE_KEY)).toBe(false);
    window.dispatchEvent(
      new CustomEvent<CookieConsentChoice>(COOKIE_CONSENT_CHANGED_EVENT, {
        detail: "accepted",
      })
    );
    expect(document.cookie).toContain(AFFILIATE_REFERRAL_STORAGE_KEY);
    unmount();
  });
});
