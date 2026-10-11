import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralCapture } from "./referral-capture";
import { AFFILIATE_REFERRAL_STORAGE_KEY } from "@/lib/affiliate-referral";
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
