import { describe, expect, it } from "vitest";
import { sanitizeSignupAttribution } from "./signup-attribution.js";
describe("signup attribution sanitization", () => {
  it("uses null for missing and malformed values", () => {
    for (const value of [null, undefined, [], 12, { utm_source: {}, referrer_host: "javascript:bad" }]) {
      expect(sanitizeSignupAttribution(value)).toEqual({
        utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
        utm_term: null, referrer_host: null, first_landing_path: null, signup_channel: "unknown",
      });
    }
  });
  it("limits campaign values and strips unsafe characters", () => {
    const result = sanitizeSignupAttribution({ utm_source: " <news>\n", utm_campaign: "x".repeat(200), utm_content: "a_b-c.d" });
    expect(result.utm_source).toBe("news");
    expect(result.utm_campaign).toHaveLength(100);
    expect(result.utm_content).toBe("a_b-c.d");
  });
  it("stores only an external hostname", () => {
    expect(sanitizeSignupAttribution({ referrer_host: "https://Search.Example/path?email=secret#fragment" }).referrer_host).toBe("search.example");
    for (const host of ["telemetry-tracker.com", "https://app.telemetry-tracker.com/x", "file://example.com/a"]) {
      expect(sanitizeSignupAttribution({ referrer_host: host }).referrer_host).toBeNull();
    }
    expect(sanitizeSignupAttribution({ referrer_host: "telemetry-tracker.com.example.org" }).referrer_host).toBe("telemetry-tracker.com.example.org");
  });
});

describe("signup funnel attribution", () => {
  it.each([
    ["https://www.google.com/search?q=private", "organic_search"],
    ["https://chatgpt.com/c/private", "ai_assistant"],
    ["https://www.linkedin.com/feed", "social"],
    ["https://example.org/private", "referral"],
    ["https://google.com.attacker.org", "referral"],
    ["https://telemetry-tracker.com", "unknown"],
  ])("classifies %s without retaining the URL", (referrer_host, channel) => {
    expect(sanitizeSignupAttribution({ referrer_host }).signup_channel).toBe(channel);
  });
  it("uses campaign medium and strips all unapproved query keys and fragments", () => {
    expect(sanitizeSignupAttribution({ utm_medium: "organic", first_landing_path: "/docs?email=private&utm_source=google&utm_medium=organic&utm_campaign=launch&utm_term=secret#private" })).toMatchObject({
      signup_channel: "organic_search", first_landing_path: "/docs?utm_source=google&utm_medium=organic&utm_campaign=launch",
    });
  });
  it.each(["https://evil.test/path", "//evil.test/path", "/\\evil.test/path"])("rejects offsite landing %s", first_landing_path => {
    expect(sanitizeSignupAttribution({ first_landing_path }).first_landing_path).toBeNull();
  });
});
