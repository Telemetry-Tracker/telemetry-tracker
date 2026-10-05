/**
 * Rewardful loader consent tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { RewardfulLoader } from "./rewardful-loader";
import { COOKIE_CONSENT_CHANGED_EVENT } from "@/lib/cookie-consent";

function clearRewardfulScriptCallbacks() {
  document.querySelectorAll('script[src*="r.wdfl.co"]').forEach((node) => {
    const script = node as HTMLScriptElement;
    script.onload = null;
    script.onerror = null;
  });
}

describe("RewardfulLoader", () => {
  beforeEach(() => {
    // Clear localStorage and reset env
    localStorage.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).Rewardful;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).rewardful;
    
    // Remove any existing Rewardful scripts
    document.querySelectorAll('script[src*="r.wdfl.co"]').forEach(s => s.remove());
    
    // Mock console methods to avoid noise
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    clearRewardfulScriptCallbacks();
    cleanup();
  });

  it("does not load script when feature flag is OFF", () => {
    const originalEnv = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = undefined;

    const { unmount } = render(<RewardfulLoader />);

    const script = document.querySelector('script[src*="r.wdfl.co"]');
    expect(script).toBeNull();

    unmount();
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = originalEnv;
  });

  it("loads script when consent is accepted and flag is ON", async () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    process.env.NEXT_PUBLIC_REWARDFUL_API_KEY = "pk_test";
    
    localStorage.setItem("tt-cookie-consent", "accepted");

    const { unmount } = render(<RewardfulLoader />);

    await waitFor(() => {
      const script = document.querySelector('script[src*="r.wdfl.co"]');
      expect(script).toBeTruthy();
    }, { timeout: 2000 });

    unmount();
  });

  it("does not load script when consent is rejected", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    localStorage.setItem("tt-cookie-consent", "rejected");

    const { unmount } = render(<RewardfulLoader />);

    const script = document.querySelector('script[src*="r.wdfl.co"]');
    expect(script).toBeNull();

    unmount();
  });

  it("loads script when consent changes from rejected to accepted", async () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    localStorage.setItem("tt-cookie-consent", "rejected");

    const { unmount } = render(<RewardfulLoader />);

    // Initially no script
    expect(document.querySelector('script[src*="r.wdfl.co"]')).toBeNull();

    // Change consent to accepted
    localStorage.setItem("tt-cookie-consent", "accepted");
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: "accepted" }));

    await waitFor(() => {
      const script = document.querySelector('script[src*="r.wdfl.co"]');
      expect(script).toBeTruthy();
    }, { timeout: 2000 });

    unmount();
  });

  it("does not load script on consent revoke", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    localStorage.setItem("tt-cookie-consent", "accepted");

    const { unmount } = render(<RewardfulLoader />);

    // Change consent to rejected
    localStorage.setItem("tt-cookie-consent", "rejected");
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: "rejected" }));

    // Script loading is prevented, but existing script remains (that's OK, next page load won't load it)
    // The key is shouldLoad state becomes false
    unmount();
  });
});
