import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { PlanTier } from "@prisma/client";
import {
  parsePlanTierFromStripeSubscription,
  parsePlanTierMetadata,
  subscriptionToOrgSyncPatch,
} from "./stripe-subscription-sync.js";

describe("parsePlanTierMetadata", () => {
  it("parses known tiers", () => {
    expect(parsePlanTierMetadata("pro")).toBe(PlanTier.PRO);
    expect(parsePlanTierMetadata("BUSINESS")).toBe(PlanTier.BUSINESS);
    expect(parsePlanTierMetadata("free")).toBe(PlanTier.FREE);
    expect(parsePlanTierMetadata("nope")).toBeNull();
  });
});

describe("parsePlanTierFromStripeSubscription", () => {
  it("prefers subscription metadata over price metadata", () => {
    const sub = {
      metadata: { plan_tier: "PRO" },
      items: {
        data: [{ price: { metadata: { plan_tier: "BUSINESS" } } }],
      },
    } as unknown as Stripe.Subscription;
    expect(parsePlanTierFromStripeSubscription(sub)).toBe(PlanTier.PRO);
    // Tier comes from metadata — not from matching STRIPE_PRICE_PRO — so legacy €29 Prices stay PRO.
  });

  it("falls back to price metadata", () => {
    const sub = {
      metadata: {},
      items: {
        data: [{ price: { metadata: { plan_tier: "business" } } }],
      },
    } as unknown as Stripe.Subscription;
    expect(parsePlanTierFromStripeSubscription(sub)).toBe(PlanTier.BUSINESS);
  });

  it("ignores FREE in metadata for patch purposes", () => {
    const sub = {
      metadata: { plan_tier: "FREE" },
      items: { data: [] },
    } as unknown as Stripe.Subscription;
    expect(parsePlanTierFromStripeSubscription(sub)).toBeNull();
  });

  it("keeps PRO for a legacy Price id when price metadata has plan_tier", () => {
    const sub = {
      metadata: {},
      items: {
        data: [{ price: { id: "price_legacy_eur_29", metadata: { plan_tier: "PRO" } } }],
      },
    } as unknown as Stripe.Subscription;
    expect(parsePlanTierFromStripeSubscription(sub)).toBe(PlanTier.PRO);
  });
});

describe("subscriptionToOrgSyncPatch", () => {
  it("includes status, period end, and optional plan_tier", () => {
    const sub = {
      metadata: { plan_tier: "PRO" },
      items: { data: [] },
      status: "active",
      current_period_end: 1_700_000_000,
    } as unknown as Stripe.Subscription;
    expect(subscriptionToOrgSyncPatch(sub)).toEqual({
      stripe_subscription_status: "active",
      stripe_current_period_end: new Date(1_700_000_000 * 1000),
      plan_tier: PlanTier.PRO,
    });
  });

  it("omits plan_tier when not derivable", () => {
    const sub = {
      metadata: {},
      items: { data: [] },
      status: "past_due",
      current_period_end: null,
    } as unknown as Stripe.Subscription;
    const p = subscriptionToOrgSyncPatch(sub);
    expect(p.plan_tier).toBeUndefined();
    expect(p.stripe_subscription_status).toBe("past_due");
    expect(p.stripe_current_period_end).toBeNull();
  });
});
