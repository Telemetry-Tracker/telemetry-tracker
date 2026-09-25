import { describe, expect, it } from "vitest";
import { isAllowedTelemetryProxyPath } from "./telemetry-proxy-path";

describe("isAllowedTelemetryProxyPath", () => {
  it("allows overview vitals and sessions summary", () => {
    expect(isAllowedTelemetryProxyPath(["performance", "summary"])).toBe(true);
    expect(isAllowedTelemetryProxyPath(["sessions", "summary"])).toBe(true);
  });

  it("still allows analytics reads and blocks everything else", () => {
    expect(isAllowedTelemetryProxyPath(["errors", "analytics"])).toBe(true);
    expect(isAllowedTelemetryProxyPath(["sessions"])).toBe(true);
    expect(isAllowedTelemetryProxyPath(["performance"])).toBe(false);
    expect(isAllowedTelemetryProxyPath(["sessions", "other"])).toBe(false);
    expect(isAllowedTelemetryProxyPath(["project", "source-maps"])).toBe(false);
    expect(isAllowedTelemetryProxyPath(["errors", "abc", "extra"])).toBe(false);
  });
});
