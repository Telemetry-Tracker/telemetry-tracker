// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parsePaidPlanQueryParam,
  paidPlanQueryToCheckoutTier,
} from "@/lib/plan-pricing";

describe("parsePaidPlanQueryParam", () => {
  it("accepts pro (case-insensitive, trimmed)", () => {
    expect(parsePaidPlanQueryParam("pro")).toBe("pro");
    expect(parsePaidPlanQueryParam("PRO")).toBe("pro");
    expect(parsePaidPlanQueryParam(" Pro ")).toBe("pro");
  });

  it("accepts business (case-insensitive, trimmed)", () => {
    expect(parsePaidPlanQueryParam("business")).toBe("business");
    expect(parsePaidPlanQueryParam("BUSINESS")).toBe("business");
    expect(parsePaidPlanQueryParam(" Business ")).toBe("business");
  });

  it("rejects free, empty, and invalid values", () => {
    expect(parsePaidPlanQueryParam("free")).toBeNull();
    expect(parsePaidPlanQueryParam("FREE")).toBeNull();
    expect(parsePaidPlanQueryParam("")).toBeNull();
    expect(parsePaidPlanQueryParam(" ")).toBeNull();
    expect(parsePaidPlanQueryParam("enterprise")).toBeNull();
    expect(parsePaidPlanQueryParam("invalid")).toBeNull();
    expect(parsePaidPlanQueryParam(null)).toBeNull();
    expect(parsePaidPlanQueryParam(undefined)).toBeNull();
  });
});

describe("paidPlanQueryToCheckoutTier", () => {
  it("maps pro to PRO", () => {
    expect(paidPlanQueryToCheckoutTier("pro")).toBe("PRO");
  });

  it("maps business to BUSINESS", () => {
    expect(paidPlanQueryToCheckoutTier("business")).toBe("BUSINESS");
  });

  it("returns null for null input", () => {
    expect(paidPlanQueryToCheckoutTier(null)).toBeNull();
  });
});
