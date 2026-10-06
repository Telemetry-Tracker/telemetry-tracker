import { describe, expect, it } from "vitest";
import { stripeSubscriptionPeriodEndUnix } from "./stripe-runtime-fields.js";

describe("stripeSubscriptionPeriodEndUnix", () => {
  it("reads top-level current_period_end (acacia and older payloads)", () => {
    expect(stripeSubscriptionPeriodEndUnix({ current_period_end: 1_700_000_000 })).toBe(
      1_700_000_000
    );
  });

  it("prefers top-level over item values when both are present", () => {
    expect(
      stripeSubscriptionPeriodEndUnix({
        current_period_end: 1_700_000_000,
        items: { data: [{ current_period_end: 1_800_000_000 }] },
      })
    ).toBe(1_700_000_000);
  });

  it("falls back to items.data[].current_period_end (basil / dahlia SDK objects)", () => {
    expect(
      stripeSubscriptionPeriodEndUnix({
        object: "subscription",
        items: { object: "list", data: [{ id: "si_1", current_period_end: 1_750_000_000 }] },
      })
    ).toBe(1_750_000_000);
  });

  it("uses the latest item period end when items differ", () => {
    expect(
      stripeSubscriptionPeriodEndUnix({
        current_period_end: null,
        items: {
          data: [
            { current_period_end: 1_710_000_000 },
            { current_period_end: 1_760_000_000 },
            { current_period_end: "nope" },
            null,
          ],
        },
      })
    ).toBe(1_760_000_000);
  });

  it("returns null when no shape carries a number", () => {
    expect(stripeSubscriptionPeriodEndUnix({})).toBeNull();
    expect(stripeSubscriptionPeriodEndUnix({ items: { data: [] } })).toBeNull();
    expect(stripeSubscriptionPeriodEndUnix({ items: { data: [{ id: "si_1" }] } })).toBeNull();
    expect(stripeSubscriptionPeriodEndUnix({ items: null })).toBeNull();
    expect(stripeSubscriptionPeriodEndUnix(null)).toBeNull();
    expect(stripeSubscriptionPeriodEndUnix("sub_123")).toBeNull();
  });
});
