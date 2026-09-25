import { afterEach, describe, expect, it } from "vitest";
import { dashboardOriginOrNull, resolveDashboardOrigin } from "./dashboard-origin.js";

describe("dashboard origin", () => {
  const prevOrigin = process.env.TELEMETRY_DASHBOARD_ORIGIN;
  const prevDashboardOrigin = process.env.DASHBOARD_ORIGIN;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (prevOrigin === undefined) delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    else process.env.TELEMETRY_DASHBOARD_ORIGIN = prevOrigin;
    if (prevDashboardOrigin === undefined) delete process.env.DASHBOARD_ORIGIN;
    else process.env.DASHBOARD_ORIGIN = prevDashboardOrigin;
    process.env.NODE_ENV = prevNodeEnv;
  });

  it("resolveDashboardOrigin strips trailing slash", () => {
    process.env.TELEMETRY_DASHBOARD_ORIGIN = "https://app.example.com/";
    expect(resolveDashboardOrigin()).toBe("https://app.example.com");
  });

  it("dashboardOriginOrNull uses localhost in non-production when unset", () => {
    delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    process.env.NODE_ENV = "test";
    expect(dashboardOriginOrNull()).toBe("http://localhost:3000");
  });

  it("dashboardOriginOrNull is null in production when unset", () => {
    delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    process.env.NODE_ENV = "production";
    expect(dashboardOriginOrNull()).toBeNull();
  });

  it("dashboardOriginOrNull prefers configured origin in production", () => {
    process.env.TELEMETRY_DASHBOARD_ORIGIN = "https://telemetry.example.com";
    process.env.NODE_ENV = "production";
    expect(dashboardOriginOrNull()).toBe("https://telemetry.example.com");
  });

  it("does not read DASHBOARD_ORIGIN for email/dashboard links", () => {
    delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    process.env.DASHBOARD_ORIGIN = "https://from-cors-var.example.com";
    process.env.NODE_ENV = "production";
    expect(resolveDashboardOrigin()).toBeNull();
    expect(dashboardOriginOrNull()).toBeNull();
  });
});
