import { describe, expect, it } from "vitest";
import {
  canResolveNeedsAttention,
  commissionDisplayState,
  isCommissionPayable,
  isPayingReferral,
  openAdjustmentsTotalCents,
  parseAffiliateApplicationFilter,
  type AffiliateCommissionRow,
} from "./affiliate-admin-types";

const now = new Date("2026-10-06T12:00:00Z");
function commission(overrides: Partial<AffiliateCommissionRow> = {}): AffiliateCommissionRow {
  return {
    id: "c1",
    organizationId: "o1",
    stripeInvoiceId: "in_1",
    amountCents: 450,
    remainingCents: 450,
    currency: "eur",
    state: "pending",
    disputeStatus: null,
    invoicePaidAt: "2026-08-01T00:00:00Z",
    payableAt: "2026-08-31T00:00:00Z",
    paidAt: null,
    payoutId: null,
    ...overrides,
  };
}

describe("affiliate admin helpers", () => {
  it("derives payable like the API (hold elapsed, no open dispute, remaining > 0)", () => {
    expect(isCommissionPayable(commission(), now)).toBe(true);
    expect(isCommissionPayable(commission({ payableAt: "2026-10-20T00:00:00Z" }), now)).toBe(false);
    expect(isCommissionPayable(commission({ disputeStatus: "open" }), now)).toBe(false);
    expect(isCommissionPayable(commission({ remainingCents: 0 }), now)).toBe(false);
    expect(isCommissionPayable(commission({ state: "paid" }), now)).toBe(false);
  });

  it("labels commission states for the founder", () => {
    expect(commissionDisplayState(commission(), now)).toBe("payable");
    expect(commissionDisplayState(commission({ payableAt: "2026-10-20T00:00:00Z" }), now)).toBe("on hold");
    expect(commissionDisplayState(commission({ disputeStatus: "open" }), now)).toBe("disputed");
    expect(commissionDisplayState(commission({ state: "voided" }), now)).toBe("voided");
  });

  it("sums only unsettled clawbacks", () => {
    const base = { currency: "eur", reason: "refund", note: null, createdAt: "2026-09-01T00:00:00Z" };
    expect(
      openAdjustmentsTotalCents([
        { ...base, id: "a1", amountCents: -300, payoutId: null },
        { ...base, id: "a2", amountCents: -200, payoutId: "p1" },
      ])
    ).toBe(-300);
  });

  it("only offers resolve on open needs-attention referrals", () => {
    const org = {
      organizationId: "o1",
      name: "Acme",
      planTier: "PRO",
      status: "ACTIVE",
      needsAttention: true,
      attentionReason: "billing_email_matches_affiliate",
      attributedAt: "2026-09-01T00:00:00Z",
    };
    expect(canResolveNeedsAttention(org)).toBe(true);
    expect(canResolveNeedsAttention({ ...org, needsAttention: false })).toBe(false);
    expect(canResolveNeedsAttention({ ...org, status: "REJECTED" })).toBe(false);
    expect(canResolveNeedsAttention({ ...org, status: "EXPIRED" })).toBe(false);
  });

  it("parses the status filter with a pending default", () => {
    expect(parseAffiliateApplicationFilter(undefined)).toBe("pending");
    expect(parseAffiliateApplicationFilter("all")).toBe("all");
    expect(parseAffiliateApplicationFilter(["rejected"])).toBe("rejected");
    expect(parseAffiliateApplicationFilter("bogus")).toBe("pending");
  });

  it("counts paying referrals like the API list (ACTIVE + PRO/BUSINESS)", () => {
    const org = {
      organizationId: "o1",
      name: "Acme",
      planTier: "PRO",
      status: "ACTIVE",
      needsAttention: false,
      attentionReason: null,
      attributedAt: "2026-09-01T00:00:00Z",
    };
    expect(isPayingReferral(org)).toBe(true);
    expect(isPayingReferral({ ...org, planTier: "BUSINESS" })).toBe(true);
    expect(isPayingReferral({ ...org, planTier: "FREE" })).toBe(false);
    expect(isPayingReferral({ ...org, status: "REJECTED" })).toBe(false);
  });
});
