import { describe, expect, it } from "vitest";
import { PlanTier } from "@prisma/client";
import {
  selectPaidTierFallbackData,
  uniqueConstraintTargets,
} from "./stripe-webhook.js";

describe("uniqueConstraintTargets", () => {
  it("extracts constrained Stripe fields from Prisma P2002 metadata", () => {
    const e = {
      code: "P2002",
      meta: { target: ["stripe_customer_id", "stripe_subscription_id"] },
    };
    expect([...uniqueConstraintTargets(e)].sort()).toEqual([
      "stripe_customer_id",
      "stripe_subscription_id",
    ]);
  });

  it("returns empty set when error is not Prisma P2002", () => {
    expect(uniqueConstraintTargets({ code: "P2025" }).size).toBe(0);
    expect(uniqueConstraintTargets(new Error("boom")).size).toBe(0);
  });
});

describe("selectPaidTierFallbackData", () => {
  it("allows fallback only for customer-id-only uniqueness conflicts", () => {
    const fallback = selectPaidTierFallbackData(
      PlanTier.PRO,
      "sub_123",
      new Set(["stripe_customer_id"])
    );
    expect(fallback).toEqual({
      plan_tier: PlanTier.PRO,
      stripe_subscription_id: "sub_123",
    });
  });

  it("rejects fallback when subscription ownership is ambiguous", () => {
    expect(
      selectPaidTierFallbackData(
        PlanTier.BUSINESS,
        "sub_123",
        new Set(["stripe_subscription_id"])
      )
    ).toBeNull();
    expect(
      selectPaidTierFallbackData(
        PlanTier.BUSINESS,
        "sub_123",
        new Set(["stripe_customer_id", "stripe_subscription_id"])
      )
    ).toBeNull();
    expect(
      selectPaidTierFallbackData(PlanTier.BUSINESS, null, new Set(["stripe_customer_id"]))
    ).toBeNull();
  });
});
