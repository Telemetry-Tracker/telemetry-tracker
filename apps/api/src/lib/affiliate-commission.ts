/**
 * Native commission engine: Stripe invoice.paid → 30% of eligible net paid.
 * Refunds/disputes adjust the ledger; history is never deleted.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { isAffiliateFeatureEnabled } from "./affiliates-feature-flag.js";
import { isPayoutHold } from "./organization-attribution.js";

export const DEFAULT_COMMISSION_RATE_BPS = 3000;
export const COMMISSION_HOLD_DAYS = 30;

export type CommissionLogger = {
  warn: (msg: unknown, context: string) => void;
  info?: (msg: unknown, context: string) => void;
};

export type InvoiceLike = {
  id?: string | null;
  amount_paid?: number | null;
  tax?: number | null;
  total_tax_amounts?: Array<{ amount?: number | null }> | null;
  total_taxes?: Array<{ amount?: number | null }> | null;
  currency?: string | null;
  subscription?: string | { id?: string | null } | null;
  customer?: string | { id?: string | null } | null;
  charge?: string | { id?: string | null } | null;
  billing_reason?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
  parent?: {
    subscription_details?: {
      subscription?: string | { id?: string | null } | null;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
};

export function invoiceTaxCents(invoice: InvoiceLike): number {
  const fromField = invoice.tax ?? 0;
  const fromAmounts = (invoice.total_tax_amounts ?? []).reduce(
    (sum, row) => sum + (row.amount ?? 0),
    0
  );
  const fromTaxes = (invoice.total_taxes ?? []).reduce(
    (sum, row) => sum + (row.amount ?? 0),
    0
  );
  return Math.max(fromField, fromAmounts, fromTaxes, 0);
}

/** Eligible net paid: amount actually paid minus VAT/tax. Never negative. */
export function eligibleNetPaidCents(invoice: InvoiceLike): number {
  const paid = invoice.amount_paid ?? 0;
  return Math.max(0, paid - invoiceTaxCents(invoice));
}

export function commissionAmountCents(
  eligibleBaseCents: number,
  rateBps: number = DEFAULT_COMMISSION_RATE_BPS
): number {
  if (eligibleBaseCents <= 0 || rateBps <= 0) return 0;
  return Math.floor((eligibleBaseCents * rateBps) / 10_000);
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function stripeObjectId(
  value: string | { id?: string | null } | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

/** Stripe v22 Charge types omit `invoice`; live payloads still include it. */
export function chargeInvoiceId(charge: unknown): string | null {
  if (!charge || typeof charge !== "object") return null;
  const invoice = (charge as { invoice?: unknown }).invoice;
  if (typeof invoice === "string") return invoice;
  if (invoice && typeof invoice === "object" && "id" in invoice) {
    const id = (invoice as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function invoiceSubscriptionId(invoice: InvoiceLike): string | null {
  const direct = stripeObjectId(invoice.subscription);
  if (direct) return direct;
  return stripeObjectId(invoice.parent?.subscription_details?.subscription);
}

function isHostedSubscriptionInvoice(invoice: InvoiceLike): boolean {
  if (invoiceSubscriptionId(invoice)) return true;
  const reason = invoice.billing_reason ?? "";
  return (
    reason === "subscription_create" ||
    reason === "subscription_cycle" ||
    reason === "subscription_update"
  );
}

export async function resolveOrgFromInvoice(
  prisma: PrismaClient,
  invoice: InvoiceLike
): Promise<{ id: string; plan_tier: string } | null> {
  const customerId = stripeObjectId(invoice.customer);
  if (customerId) {
    const byCustomer = await prisma.organization.findFirst({
      where: { stripe_customer_id: customerId, deleted_at: null },
      select: { id: true, plan_tier: true },
    });
    if (byCustomer) return byCustomer;
  }

  const subId = invoiceSubscriptionId(invoice);
  if (subId) {
    const bySub = await prisma.organization.findFirst({
      where: { stripe_subscription_id: subId, deleted_at: null },
      select: { id: true, plan_tier: true },
    });
    if (bySub) return bySub;
  }

  const orgId =
    invoice.subscription_details?.metadata?.organization_id ??
    invoice.parent?.subscription_details?.metadata?.organization_id ??
    null;
  if (orgId) {
    return prisma.organization.findFirst({
      where: { id: orgId, deleted_at: null },
      select: { id: true, plan_tier: true },
    });
  }
  return null;
}

export type RecordCommissionResult =
  | { kind: "not_enabled" }
  | { kind: "skipped"; reason: string }
  | { kind: "created"; commissionId: string; amountCents: number }
  | { kind: "duplicate"; commissionId: string };

export async function recordCommissionFromInvoice(
  prisma: PrismaClient,
  invoice: InvoiceLike,
  logger?: CommissionLogger
): Promise<RecordCommissionResult> {
  if (!isAffiliateFeatureEnabled()) {
    return { kind: "not_enabled" };
  }
  const invoiceId = invoice.id?.trim();
  if (!invoiceId) {
    return { kind: "skipped", reason: "missing_invoice_id" };
  }
  if (!isHostedSubscriptionInvoice(invoice)) {
    return { kind: "skipped", reason: "not_hosted_subscription" };
  }

  const existing = await prisma.affiliateCommission.findUnique({
    where: { stripe_invoice_id: invoiceId },
    select: { id: true },
  });
  if (existing) {
    return { kind: "duplicate", commissionId: existing.id };
  }

  const org = await resolveOrgFromInvoice(prisma, invoice);
  if (!org) {
    return { kind: "skipped", reason: "org_not_found" };
  }

  const referral = await prisma.organizationReferral.findUnique({
    where: { organization_id: org.id },
    select: {
      affiliate_id: true,
      status: true,
      needs_attention: true,
      attention_reason: true,
    },
  });
  if (!referral?.affiliate_id || referral.status !== "ACTIVE") {
    return { kind: "skipped", reason: "not_attributed" };
  }
  if (isPayoutHold(referral)) {
    return { kind: "skipped", reason: "payout_hold" };
  }

  const affiliate = await prisma.affiliate.findUnique({
    where: { id: referral.affiliate_id },
    select: { id: true, state: true, commission_rate_bps: true },
  });
  if (!affiliate || affiliate.state !== "active") {
    return { kind: "skipped", reason: "affiliate_disabled" };
  }

  const eligible = eligibleNetPaidCents(invoice);
  if (eligible <= 0) {
    return { kind: "skipped", reason: "zero_eligible_paid" };
  }
  const amount = commissionAmountCents(eligible, affiliate.commission_rate_bps);
  if (amount <= 0) {
    return { kind: "skipped", reason: "zero_commission" };
  }

  const paidAtUnix = invoice.status_transitions?.paid_at;
  const invoicePaidAt = paidAtUnix ? new Date(paidAtUnix * 1000) : new Date();
  const payableAt = addDays(invoicePaidAt, COMMISSION_HOLD_DAYS);
  const currency = (invoice.currency ?? "eur").toLowerCase();
  const chargeId = stripeObjectId(invoice.charge);

  try {
    const created = await prisma.affiliateCommission.create({
      data: {
        affiliate_id: affiliate.id,
        organization_id: org.id,
        stripe_invoice_id: invoiceId,
        stripe_charge_id: chargeId,
        eligible_base_cents: eligible,
        amount_cents: amount,
        remaining_cents: amount,
        currency,
        state: "pending",
        invoice_paid_at: invoicePaidAt,
        payable_at: payableAt,
      },
      select: { id: true },
    });
    logger?.info?.(
      { commissionId: created.id, invoiceId, orgId: org.id, amount },
      "Recorded affiliate commission"
    );
    return { kind: "created", commissionId: created.id, amountCents: amount };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const again = await prisma.affiliateCommission.findUnique({
        where: { stripe_invoice_id: invoiceId },
        select: { id: true },
      });
      if (again) return { kind: "duplicate", commissionId: again.id };
    }
    throw err;
  }
}

export type ApplyRefundResult =
  | { kind: "not_enabled" }
  | { kind: "skipped"; reason: string }
  | { kind: "voided"; commissionId: string }
  | { kind: "reduced"; commissionId: string; remainingCents: number }
  | { kind: "adjusted"; adjustmentId: string };

function refundedRatio(chargeAmount: number, amountRefunded: number): number {
  if (chargeAmount <= 0) return 1;
  return Math.min(1, Math.max(0, amountRefunded / chargeAmount));
}

export async function applyRefundToCommission(
  prisma: PrismaClient,
  input: {
    invoiceId?: string | null;
    chargeId?: string | null;
    chargeAmount: number;
    amountRefunded: number;
    refundId?: string | null;
    currency?: string | null;
  },
  logger?: CommissionLogger
): Promise<ApplyRefundResult> {
  if (!isAffiliateFeatureEnabled()) return { kind: "not_enabled" };
  if (input.amountRefunded <= 0) return { kind: "skipped", reason: "no_refund" };

  const commission = await findCommissionForCharge(prisma, input);
  if (!commission) return { kind: "skipped", reason: "commission_not_found" };

  const ratio = refundedRatio(input.chargeAmount, input.amountRefunded);
  const targetRemaining = Math.floor(commission.amount_cents * (1 - ratio));
  const currency = (input.currency ?? commission.currency).toLowerCase();

  if (commission.state === "paid") {
    const already = await prisma.affiliateAdjustment.aggregate({
      where: {
        commission_id: commission.id,
        reason: "refund",
        payout_id: null,
      },
      _sum: { amount_cents: true },
    });
    const alreadyClawed = Math.abs(already._sum.amount_cents ?? 0);
    const desiredClawback = commission.amount_cents - targetRemaining;
    const delta = desiredClawback - alreadyClawed;
    if (delta <= 0) return { kind: "skipped", reason: "already_adjusted" };

    const adjustment = await prisma.affiliateAdjustment.create({
      data: {
        affiliate_id: commission.affiliate_id,
        organization_id: commission.organization_id,
        commission_id: commission.id,
        amount_cents: -delta,
        currency,
        reason: "refund",
        note: "Refund after payout",
        stripe_refund_id: input.refundId ?? null,
        stripe_invoice_id: commission.stripe_invoice_id,
      },
      select: { id: true },
    });
    return { kind: "adjusted", adjustmentId: adjustment.id };
  }

  if (commission.state === "voided") {
    return { kind: "skipped", reason: "already_voided" };
  }

  const reduction = commission.remaining_cents - targetRemaining;
  if (reduction <= 0) {
    return { kind: "skipped", reason: "already_reduced" };
  }

  const nextState = targetRemaining <= 0 ? "voided" : commission.state;
  await prisma.$transaction(async (tx) => {
    await tx.affiliateCommission.update({
      where: { id: commission.id },
      data: {
        remaining_cents: Math.max(0, targetRemaining),
        state: nextState,
        voided_at: nextState === "voided" ? new Date() : commission.voided_at,
      },
    });
    await tx.affiliateAdjustment.create({
      data: {
        affiliate_id: commission.affiliate_id,
        organization_id: commission.organization_id,
        commission_id: commission.id,
        amount_cents: -reduction,
        currency,
        reason: "refund",
        note: nextState === "voided" ? "Full refund before payout" : "Partial refund before payout",
        stripe_refund_id: input.refundId ?? null,
        stripe_invoice_id: commission.stripe_invoice_id,
      },
    });
  });

  logger?.info?.(
    { commissionId: commission.id, targetRemaining, nextState },
    "Applied refund to affiliate commission"
  );

  if (nextState === "voided") {
    return { kind: "voided", commissionId: commission.id };
  }
  return { kind: "reduced", commissionId: commission.id, remainingCents: targetRemaining };
}

async function findCommissionForCharge(
  prisma: PrismaClient,
  input: { invoiceId?: string | null; chargeId?: string | null }
) {
  if (input.invoiceId) {
    const byInvoice = await prisma.affiliateCommission.findUnique({
      where: { stripe_invoice_id: input.invoiceId },
    });
    if (byInvoice) return byInvoice;
  }
  if (input.chargeId) {
    return prisma.affiliateCommission.findFirst({
      where: { stripe_charge_id: input.chargeId },
    });
  }
  return null;
}

export type ApplyDisputeResult =
  | { kind: "not_enabled" }
  | { kind: "skipped"; reason: string }
  | { kind: "held"; commissionId: string }
  | { kind: "restored"; commissionId: string }
  | { kind: "voided"; commissionId: string }
  | { kind: "adjusted"; adjustmentId: string };

export async function applyDisputeToCommission(
  prisma: PrismaClient,
  input: {
    invoiceId?: string | null;
    chargeId?: string | null;
    status: "open" | "won" | "lost";
    currency?: string | null;
  }
): Promise<ApplyDisputeResult> {
  if (!isAffiliateFeatureEnabled()) return { kind: "not_enabled" };
  const commission = await findCommissionForCharge(prisma, input);
  if (!commission) return { kind: "skipped", reason: "commission_not_found" };

  if (input.status === "open") {
    if (commission.dispute_status === "open") {
      return { kind: "skipped", reason: "already_open" };
    }
    await prisma.affiliateCommission.update({
      where: { id: commission.id },
      data: { dispute_status: "open" },
    });
    return { kind: "held", commissionId: commission.id };
  }

  if (input.status === "won") {
    await prisma.affiliateCommission.update({
      where: { id: commission.id },
      data: { dispute_status: "won" },
    });
    return { kind: "restored", commissionId: commission.id };
  }

  // lost
  if (commission.state === "paid") {
    const already = await prisma.affiliateAdjustment.findFirst({
      where: { commission_id: commission.id, reason: "dispute_lost" },
      select: { id: true },
    });
    if (already) return { kind: "skipped", reason: "already_adjusted" };
    const adjustment = await prisma.affiliateAdjustment.create({
      data: {
        affiliate_id: commission.affiliate_id,
        organization_id: commission.organization_id,
        commission_id: commission.id,
        amount_cents: -commission.amount_cents,
        currency: (input.currency ?? commission.currency).toLowerCase(),
        reason: "dispute_lost",
        note: "Dispute lost after payout",
        stripe_invoice_id: commission.stripe_invoice_id,
      },
      select: { id: true },
    });
    await prisma.affiliateCommission.update({
      where: { id: commission.id },
      data: { dispute_status: "lost" },
    });
    return { kind: "adjusted", adjustmentId: adjustment.id };
  }

  if (commission.state === "voided") {
    await prisma.affiliateCommission.update({
      where: { id: commission.id },
      data: { dispute_status: "lost" },
    });
    return { kind: "skipped", reason: "already_voided" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.affiliateCommission.update({
      where: { id: commission.id },
      data: {
        remaining_cents: 0,
        state: "voided",
        voided_at: new Date(),
        dispute_status: "lost",
      },
    });
    await tx.affiliateAdjustment.create({
      data: {
        affiliate_id: commission.affiliate_id,
        organization_id: commission.organization_id,
        commission_id: commission.id,
        amount_cents: -commission.remaining_cents,
        currency: (input.currency ?? commission.currency).toLowerCase(),
        reason: "dispute_lost",
        note: "Dispute lost before payout",
        stripe_invoice_id: commission.stripe_invoice_id,
      },
    });
  });
  return { kind: "voided", commissionId: commission.id };
}

export function mapStripeDisputeStatus(
  status: Stripe.Dispute.Status | string
): "open" | "won" | "lost" {
  if (status === "won" || status === "warning_closed") return "won";
  if (status === "lost") return "lost";
  return "open";
}

export type EffectiveCommissionState = "pending" | "payable" | "paid" | "voided";

export function effectiveCommissionState(
  commission: {
    state: string;
    payable_at: Date;
    remaining_cents: number;
    dispute_status?: string | null;
  },
  now: Date = new Date()
): EffectiveCommissionState {
  if (commission.state === "paid" || commission.state === "voided") {
    return commission.state;
  }
  if (commission.remaining_cents <= 0) return "voided";
  if (commission.dispute_status === "open") return "pending";
  if (now.getTime() >= commission.payable_at.getTime()) return "payable";
  return "pending";
}

/** Used by Prisma transactions for payouts. */
export type AffiliateDb = PrismaClient | Prisma.TransactionClient;
