import { describe, expect, it } from "vitest";
import { sanitizeSignupAttribution } from "./signup-attribution";
describe("signup attribution sanitization", () => {
  it("uses null for missing and malformed values", () => {
    for (const value of [null, undefined, [], 12, { utm_source: {}, referrer_host: "javascript:bad" }]) {
      expect(Object.values(sanitizeSignupAttribution(value))).toEqual([null, null, null, null, null, null]);
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
