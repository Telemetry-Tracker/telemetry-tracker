/**
 * Founder-only affiliate create / update / inspect helpers.
 */
import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  isValidAffiliateCode,
  normalizeAffiliateCode,
  parseAffiliateCode,
  slugifyAffiliateCode,
} from "./affiliate-code.js";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";
import { DEFAULT_COMMISSION_RATE_BPS } from "./affiliate-commission.js";
import { computeAffiliateBalance } from "./affiliate-payout.js";

export type CreateAffiliateInput = {
  name: string;
  email?: string | null;
  code?: string | null;
};

export type CreateAffiliateResult =
  | { kind: "created"; id: string; code: string }
  | { kind: "refused"; code: "invalid_name" | "invalid_code" | "code_taken"; message: string };

export type UpdateAffiliateInput = {
  name?: string;
  email?: string | null;
  state?: "active" | "disabled";
};

function trimName(raw: string): string | null {
  const name = raw.trim().slice(0, 120);
  return name.length > 0 ? name : null;
}

async function allocateUniqueCode(
  prisma: PrismaClient,
  requested: string | null | undefined,
  name: string
): Promise<{ kind: "ok"; code: string } | { kind: "taken" } | { kind: "invalid" }> {
  if (requested?.trim()) {
    const parsed = parseAffiliateCode(requested);
    if (!parsed) return { kind: "invalid" };
    const existing = await prisma.affiliate.findUnique({
      where: { code: parsed },
      select: { id: true },
    });
    if (existing) return { kind: "taken" };
    return { kind: "ok", code: parsed };
  }

  const base = slugifyAffiliateCode(name);
  for (let i = 0; i < 8; i++) {
    const suffix = i === 0 ? "" : `-${randomBytes(2).toString("hex")}`;
    const candidate = `${base}${suffix}`.slice(0, 64);
    if (!isValidAffiliateCode(candidate)) continue;
    const code = normalizeAffiliateCode(candidate);
    const existing = await prisma.affiliate.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!existing) return { kind: "ok", code };
  }
  return { kind: "taken" };
}

export async function createAffiliate(
  prisma: PrismaClient,
  input: CreateAffiliateInput
): Promise<CreateAffiliateResult> {
  const name = trimName(input.name);
  if (!name) {
    return { kind: "refused", code: "invalid_name", message: "name is required" };
  }
  const allocated = await allocateUniqueCode(prisma, input.code, name);
  if (allocated.kind === "invalid") {
    return {
      kind: "refused",
      code: "invalid_code",
      message: "code must be 2–64 characters (letters, numbers, hyphen, underscore) and not a UUID",
    };
  }
  if (allocated.kind === "taken") {
    return { kind: "refused", code: "code_taken", message: "Affiliate code is already in use" };
  }

  const email = input.email?.trim() ? input.email.trim().slice(0, 254) : null;
  const created = await prisma.affiliate.create({
    data: {
      code: allocated.code,
      name,
      email,
      email_normalized: email ? normalizeEmailForSelfReferralCheck(email) : null,
      state: "active",
      commission_rate_bps: DEFAULT_COMMISSION_RATE_BPS,
    },
    select: { id: true, code: true },
  });
  return { kind: "created", id: created.id, code: created.code };
}

export async function updateAffiliate(
  prisma: PrismaClient,
  affiliateId: string,
  input: UpdateAffiliateInput
): Promise<{ kind: "updated" } | { kind: "not_found" } | { kind: "refused"; message: string }> {
  const existing = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { id: true },
  });
  if (!existing) return { kind: "not_found" };

  const data: {
    name?: string;
    email?: string | null;
    email_normalized?: string | null;
    state?: string;
  } = {};
  if (input.name !== undefined) {
    const name = trimName(input.name);
    if (!name) return { kind: "refused", message: "name is required" };
    data.name = name;
  }
  if (input.email !== undefined) {
    const email = input.email?.trim() ? input.email.trim().slice(0, 254) : null;
    data.email = email;
    data.email_normalized = email ? normalizeEmailForSelfReferralCheck(email) : null;
  }
  if (input.state !== undefined) {
    if (input.state !== "active" && input.state !== "disabled") {
      return { kind: "refused", message: "state must be active or disabled" };
    }
    data.state = input.state;
  }

  await prisma.affiliate.update({
    where: { id: affiliateId },
    data,
  });
  return { kind: "updated" };
}

export async function listAffiliatesForAdmin(prisma: PrismaClient) {
  const affiliates = await prisma.affiliate.findMany({
    orderBy: { created_at: "asc" },
    include: {
      _count: {
        select: {
          organization_referrals: true,
        },
      },
    },
  });

  const payingCounts = await prisma.organizationReferral.groupBy({
    by: ["affiliate_id"],
    where: {
      status: "ACTIVE",
      organization: { plan_tier: { in: ["PRO", "BUSINESS"] }, deleted_at: null },
    },
    _count: { _all: true },
  });
  const payingByAffiliate = new Map(
    payingCounts.map((row) => [row.affiliate_id, row._count._all])
  );

  const rows = [];
  for (const affiliate of affiliates) {
    const balance = await computeAffiliateBalance(prisma, affiliate.id);
    rows.push({
      id: affiliate.id,
      code: affiliate.code,
      name: affiliate.name,
      email: affiliate.email,
      state: affiliate.state,
      commissionRateBps: affiliate.commission_rate_bps,
      referralCount: affiliate._count.organization_referrals,
      payingReferralCount: payingByAffiliate.get(affiliate.id) ?? 0,
      ...balance,
    });
  }
  return rows;
}

export async function getAffiliateDetailForAdmin(prisma: PrismaClient, affiliateId: string) {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
  });
  if (!affiliate) return null;

  const [balance, orgs, commissions, adjustments, payouts] = await Promise.all([
    computeAffiliateBalance(prisma, affiliateId),
    prisma.organizationReferral.findMany({
      where: { affiliate_id: affiliateId },
      include: {
        organization: {
          select: { id: true, name: true, plan_tier: true, deleted_at: true },
        },
      },
      orderBy: { attributed_at: "desc" },
    }),
    prisma.affiliateCommission.findMany({
      where: { affiliate_id: affiliateId },
      orderBy: { invoice_paid_at: "desc" },
    }),
    prisma.affiliateAdjustment.findMany({
      where: { affiliate_id: affiliateId },
      orderBy: { created_at: "desc" },
    }),
    prisma.affiliatePayout.findMany({
      where: { affiliate_id: affiliateId },
      orderBy: { paid_at: "desc" },
    }),
  ]);

  return {
    ...affiliate,
    ...balance,
    organizations: orgs.map((row) => ({
      organizationId: row.organization_id,
      name: row.organization.name,
      planTier: row.organization.plan_tier,
      status: row.status,
      needsAttention: row.needs_attention,
      attentionReason: row.attention_reason,
      attributedAt: row.attributed_at.toISOString(),
    })),
    commissions: commissions.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      stripeInvoiceId: row.stripe_invoice_id,
      amountCents: row.amount_cents,
      remainingCents: row.remaining_cents,
      currency: row.currency,
      state: row.state,
      disputeStatus: row.dispute_status,
      invoicePaidAt: row.invoice_paid_at.toISOString(),
      payableAt: row.payable_at.toISOString(),
      paidAt: row.paid_at?.toISOString() ?? null,
      payoutId: row.payout_id,
    })),
    adjustments: adjustments.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      currency: row.currency,
      reason: row.reason,
      note: row.note,
      payoutId: row.payout_id,
      createdAt: row.created_at.toISOString(),
    })),
    payouts: payouts.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      currency: row.currency,
      paidAt: row.paid_at.toISOString(),
      referenceNote: row.reference_note,
      createdBy: row.created_by,
    })),
  };
}
