import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralCapture } from "./referral-capture";
import { AFFILIATE_REFERRAL_STORAGE_KEY } from "@/lib/affiliate-referral";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("ref=alice"),
}));

describe("ReferralCapture", () => {
  const originalFlag = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;

  beforeEach(() => {
    window.sessionStorage.clear();
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
});
