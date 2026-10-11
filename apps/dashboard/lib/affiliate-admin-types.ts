/** Shapes returned by the founder-only `/api/meta/affiliates*` API (client-safe). */

export type AffiliateApplicationStatus = "pending" | "approved" | "rejected";
export type AffiliateApplicationFilter = AffiliateApplicationStatus | "all";

export const AFFILIATE_APPLICATION_FILTERS: { value: AffiliateApplicationFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export function parseAffiliateApplicationFilter(raw: string | string[] | undefined): AffiliateApplicationFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return AFFILIATE_APPLICATION_FILTERS.some((f) => f.value === value)
    ? (value as AffiliateApplicationFilter)
    : "pending";
}

export type AffiliateApplicationRow = {
  id: string;
  name: string;
  email: string;
  websiteUrl: string;
  promotionPlan: string;
  termsVersion: string;
  termsAcceptedAt: string;
  status: AffiliateApplicationStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  affiliateId: string | null;
  affiliateCode: string | null;
  createdAt: string;
  updatedAt: string;
  existingAffiliate: { id: string; code: string } | null;
  suggestedCode: string | null;
};

export type AffiliateBalance = {
  pendingCents: number;
  payableCents: number;
  paidCents: number;
  adjustmentCents: number;
  currentPayableBalanceCents: number;
  payoutEligible: boolean;
};

export type AffiliateListRow = AffiliateBalance & {
  id: string;
  code: string;
  name: string;
  email: string | null;
  state: string;
  commissionRateBps: number;
  referralCount: number;
  payingReferralCount: number;
};

export type AffiliateOrganizationRow = {
  organizationId: string;
  name: string;
  planTier: string;
  status: string;
  needsAttention: boolean;
  attentionReason: string | null;
  attributedAt: string;
};

export type AffiliateCommissionRow = {
  id: string;
  organizationId: string;
  stripeInvoiceId: string;
  amountCents: number;
  remainingCents: number;
  currency: string;
  state: string;
  disputeStatus: string | null;
  invoicePaidAt: string;
  payableAt: string;
  paidAt: string | null;
  payoutId: string | null;
};

export type AffiliateAdjustmentRow = {
  id: string;
  amountCents: number;
  currency: string;
  reason: string;
  note: string | null;
  payoutId: string | null;
  createdAt: string;
};

export type AffiliatePayoutRow = {
  id: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  referenceNote: string | null;
  createdBy: string;
};

export type AffiliateDetail = AffiliateBalance & {
  id: string;
  code: string;
  name: string;
  email: string | null;
  state: string;
  commission_rate_bps: number;
  created_at: string;
  organizations: AffiliateOrganizationRow[];
  commissions: AffiliateCommissionRow[];
  adjustments: AffiliateAdjustmentRow[];
  payouts: AffiliatePayoutRow[];
};

/** Mirrors the API's derived `payable` state (pending + hold elapsed + no open dispute + remaining > 0). */
export function isCommissionPayable(row: AffiliateCommissionRow, now: Date = new Date()): boolean {
  return (
    row.state === "pending" &&
    new Date(row.payableAt).getTime() <= now.getTime() &&
    row.disputeStatus !== "open" &&
    row.remainingCents > 0
  );
}

export function commissionDisplayState(row: AffiliateCommissionRow, now: Date = new Date()): string {
  if (row.state === "pending" && row.disputeStatus === "open") return "disputed";
  if (row.state === "pending") return isCommissionPayable(row, now) ? "payable" : "on hold";
  return row.state;
}

/** Unsettled post-payout clawbacks the API auto-includes in the next payout. */
export function openAdjustmentsTotalCents(adjustments: AffiliateAdjustmentRow[]): number {
  return adjustments.filter((a) => a.payoutId === null).reduce((sum, a) => sum + a.amountCents, 0);
}

/** Holds the founder can clear with resolve-needs-attention (API refuses REJECTED / EXPIRED). */
export function canResolveNeedsAttention(org: AffiliateOrganizationRow): boolean {
  return org.needsAttention && org.status !== "REJECTED" && org.status !== "EXPIRED";
}

/** Mirrors the API list's `payingReferralCount`: ACTIVE referral on a hosted PRO / BUSINESS plan. */
export function isPayingReferral(org: AffiliateOrganizationRow): boolean {
  return org.status === "ACTIVE" && (org.planTier === "PRO" || org.planTier === "BUSINESS");
}
