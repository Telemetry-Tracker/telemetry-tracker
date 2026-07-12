import { describe, expect, it } from "vitest";
import { sessionDeviceFromUserAgent } from "./session-device.js";

describe("sessionDeviceFromUserAgent", () => {
  it("parses Chrome on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(sessionDeviceFromUserAgent(ua)).toEqual({
      userAgent: ua,
      deviceBrowser: "Chrome",
      deviceOs: "macOS",
    });
  });


  it("parses Safari on iOS before macOS-like substring", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(sessionDeviceFromUserAgent(ua)).toEqual({
      userAgent: ua,
      deviceBrowser: "Safari",
      deviceOs: "iOS",
    });
  });

  it("returns empty hints for missing user agent", () => {
    expect(sessionDeviceFromUserAgent(undefined)).toEqual({});
  });

  it("truncates long user agent strings", () => {
    const ua = "x".repeat(600);
    expect(sessionDeviceFromUserAgent(ua).userAgent).toHaveLength(512);
  });
});
