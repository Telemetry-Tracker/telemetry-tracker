import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignupAttributionCapture } from "./signup-attribution-capture";
import { COOKIE_CONSENT_CHANGED_EVENT, COOKIE_CONSENT_STORAGE_KEY } from "@/lib/cookie-consent";
import { readSignupAttribution, SIGNUP_ATTRIBUTION_COOKIE } from "@/lib/signup-attribution";

function consent(choice: "accepted" | "rejected") {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: choice }));
}
beforeEach(() => {
  localStorage.clear();
  document.cookie = `${SIGNUP_ATTRIBUTION_COOKIE}=; Path=/; Max-Age=0`;
  document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=; Path=/; Max-Age=0`;
  window.history.replaceState({}, "", "/?utm_source=first&utm_campaign=launch");
});
afterEach(cleanup);
describe("first-touch signup capture", () => {
  it("waits for consent and preserves the initial landing across navigation", () => {
    render(<SignupAttributionCapture />);
    expect(document.cookie).not.toContain(SIGNUP_ATTRIBUTION_COOKIE);
    window.history.replaceState({}, "", "/register?utm_source=later");
    consent("accepted");
    expect(readSignupAttribution()).toMatchObject({ utm_source: "first", first_landing_path: "/?utm_source=first&utm_campaign=launch", signup_channel: "unknown" });
    cleanup();
    render(<SignupAttributionCapture />);
    expect(readSignupAttribution()?.utm_campaign).toBe("launch");
    consent("rejected");
    expect(document.cookie).not.toContain(SIGNUP_ATTRIBUTION_COOKIE);
    expect(readSignupAttribution()).toBeNull();
  });
  it("remembers direct traffic rather than overwriting it with a later campaign", () => {
    window.history.replaceState({}, "", "/");
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    render(<SignupAttributionCapture />);
    expect(readSignupAttribution()?.utm_source).toBeNull();
    cleanup();
    window.history.replaceState({}, "", "/?utm_source=later");
    render(<SignupAttributionCapture />);
    expect(readSignupAttribution()?.utm_source).toBeNull();
  });
  it("ignores corrupt cookies without throwing", () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    document.cookie = `${SIGNUP_ATTRIBUTION_COOKIE}=%broken; Path=/`;
    expect(readSignupAttribution()).toBeNull();
    render(<SignupAttributionCapture />);
    expect(readSignupAttribution()?.utm_source).toBe("first");
  });
});
