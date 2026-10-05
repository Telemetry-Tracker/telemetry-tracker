import { describe, expect, it } from "vitest";
import {
  addDays,
  commissionAmountCents,
  COMMISSION_HOLD_DAYS,
  effectiveCommissionState,
  eligibleNetPaidCents,
  invoiceTaxCents,
  mapStripeDisputeStatus,
  postPayoutClawbackDelta,
} from "./affiliate-commission.js";
import { PAYOUT_MINIMUM_CENTS } from "./affiliate-payout.js";

describe("eligibleNetPaidCents", () => {
  it("excludes tax from amount_paid", () => {
    expect(
      eligibleNetPaidCents({
        amount_paid: 3509,
        tax: 609,
      })
    ).toBe(2900);
  });

  it("uses total_tax_amounts when tax field is missing", () => {
    expect(
      eligibleNetPaidCents({
        amount_paid: 3509,
        total_tax_amounts: [{ amount: 609 }],
      })
    ).toBe(2900);
  });

  it("returns 0 when credits/discounts mean nothing was paid", () => {
    expect(eligibleNetPaidCents({ amount_paid: 0, tax: 0 })).toBe(0);
    expect(eligibleNetPaidCents({ amount_paid: 100, tax: 200 })).toBe(0);
  });

  it("does not add discounts back — amount_paid is already net", () => {
    expect(eligibleNetPaidCents({ amount_paid: 2000, tax: 0 })).toBe(2000);
  });
});

describe("invoiceTaxCents", () => {
  it("prefers the largest explicit tax figure", () => {
    expect(
      invoiceTaxCents({
        tax: 100,
        total_tax_amounts: [{ amount: 200 }],
        total_taxes: [{ amount: 50 }],
      })
    ).toBe(200);
  });
});

describe("commissionAmountCents", () => {
  it("takes 30% in integer cents", () => {
    expect(commissionAmountCents(2900)).toBe(870);
    expect(commissionAmountCents(1999)).toBe(599);
    expect(commissionAmountCents(0)).toBe(0);
  });
});

describe("effectiveCommissionState", () => {
  const paidAt = new Date("2026-09-01T00:00:00.000Z");
  const payableAt = addDays(paidAt, COMMISSION_HOLD_DAYS);

  it("stays pending during the 30-day hold", () => {
    expect(
      effectiveCommissionState(
        {
          state: "pending",
          payable_at: payableAt,
          remaining_cents: 870,
          dispute_status: null,
        },
        new Date("2026-09-15T00:00:00.000Z")
      )
    ).toBe("pending");
  });

  it("becomes payable after the hold unless disputed", () => {
    expect(
      effectiveCommissionState(
        {
          state: "pending",
          payable_at: payableAt,
          remaining_cents: 870,
          dispute_status: null,
        },
        payableAt
      )
    ).toBe("payable");
    expect(
      effectiveCommissionState(
        {
          state: "pending",
          payable_at: payableAt,
          remaining_cents: 870,
          dispute_status: "open",
        },
        payableAt
      )
    ).toBe("pending");
  });

  it("preserves paid and voided", () => {
    expect(
      effectiveCommissionState({
        state: "paid",
        payable_at: payableAt,
        remaining_cents: 870,
      })
    ).toBe("paid");
    expect(
      effectiveCommissionState({
        state: "voided",
        payable_at: payableAt,
        remaining_cents: 0,
      })
    ).toBe("voided");
  });
});

describe("payout threshold", () => {
  it("treats €49.99 as ineligible and €50.00 as eligible", () => {
    expect(4999 >= PAYOUT_MINIMUM_CENTS).toBe(false);
    expect(5000 >= PAYOUT_MINIMUM_CENTS).toBe(true);
  });
});

describe("mapStripeDisputeStatus", () => {
  it("maps Stripe statuses to open/won/lost", () => {
    expect(mapStripeDisputeStatus("needs_response")).toBe("open");
    expect(mapStripeDisputeStatus("won")).toBe("won");
    expect(mapStripeDisputeStatus("warning_closed")).toBe("won");
    expect(mapStripeDisputeStatus("lost")).toBe("lost");
  });
});

describe("postPayoutClawbackDelta", () => {
  it("claws only what was paid minus the desired remaining, net of prior clawbacks", () => {
    expect(
      postPayoutClawbackDelta({
        amountActuallyPaid: 500,
        targetRemainingDesired: 0,
        priorClawbackCents: 0,
      })
    ).toBe(500);
    expect(
      postPayoutClawbackDelta({
        amountActuallyPaid: 1000,
        targetRemainingDesired: 0,
        priorClawbackCents: 500,
      })
    ).toBe(500);
    expect(
      postPayoutClawbackDelta({
        amountActuallyPaid: 500,
        targetRemainingDesired: 0,
        priorClawbackCents: 500,
      })
    ).toBe(0);
  });
});
