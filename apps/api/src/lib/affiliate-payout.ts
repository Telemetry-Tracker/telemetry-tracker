/**
 * Manual founder payouts. No automated money movement.
 */
import type { PrismaClient } from "@prisma/client";
import {
  effectiveCommissionState,
} from "./affiliate-commission.js";

export const PAYOUT_MINIMUM_CENTS = 5000;

export type AffiliateBalance = {
  pendingCents: number;
  payableCents: number;
  paidCents: number;
  adjustmentCents: number;
  currentPayableBalanceCents: number;
  payoutEligible: boolean;
};

export async function computeAffiliateBalance(
  prisma: PrismaClient,
  affiliateId: string,
  now: Date = new Date()
): Promise<AffiliateBalance> {
  const [commissions, openAdjustments] = await Promise.all([
    prisma.affiliateCommission.findMany({
      where: { affiliate_id: affiliateId },
      select: {
        state: true,
        remaining_cents: true,
        amount_cents: true,
        payable_at: true,
        dispute_status: true,
      },
    }),
    prisma.affiliateAdjustment.findMany({
      where: { affiliate_id: affiliateId, payout_id: null },
      select: { amount_cents: true },
    }),
  ]);

  let pendingCents = 0;
  let payableCents = 0;
  let paidCents = 0;
  for (const row of commissions) {
    const effective = effectiveCommissionState(row, now);
    if (effective === "pending") pendingCents += row.remaining_cents;
    else if (effective === "payable") payableCents += row.remaining_cents;
    else if (effective === "paid") paidCents += row.amount_cents;
  }
  const adjustmentCents = openAdjustments.reduce((sum, row) => sum + row.amount_cents, 0);
  const currentPayableBalanceCents = payableCents + adjustmentCents;
  return {
    pendingCents,
    payableCents,
    paidCents,
    adjustmentCents,
    currentPayableBalanceCents,
    payoutEligible: currentPayableBalanceCents >= PAYOUT_MINIMUM_CENTS,
  };
}

export type MarkPayoutPaidInput = {
  affiliateId: string;
  actorUserId: string;
  commissionIds: string[];
  adjustmentIds?: string[];
  amountCents: number;
  paidAt?: Date;
  referenceNote?: string | null;
  idempotencyKey?: string | null;
};

export type MarkPayoutPaidResult =
  | {
      kind: "paid";
      payoutId: string;
      amountCents: number;
      idempotent: boolean;
    }
  | { kind: "not_found" }
  | {
      kind: "refused";
      code:
        | "below_minimum"
        | "amount_mismatch"
        | "not_payable"
        | "already_paid"
        | "invalid_selection"
        | "affiliate_disabled";
      message: string;
    };

export async function markAffiliatePayoutPaid(
  prisma: PrismaClient,
  input: MarkPayoutPaidInput,
  now: Date = new Date()
): Promise<MarkPayoutPaidResult> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: input.affiliateId },
    select: { id: true, state: true },
  });
  if (!affiliate) return { kind: "not_found" };

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await prisma.affiliatePayout.findUnique({
      where: { idempotency_key: idempotencyKey },
      select: { id: true, amount_cents: true, affiliate_id: true },
    });
    if (existing) {
      if (existing.affiliate_id !== affiliate.id) {
        return {
          kind: "refused",
          code: "invalid_selection",
          message: "Idempotency key belongs to another affiliate",
        };
      }
      return {
        kind: "paid",
        payoutId: existing.id,
        amountCents: existing.amount_cents,
        idempotent: true,
      };
    }
  }

  const commissionIds = [...new Set(input.commissionIds)];
  const adjustmentIds = [...new Set(input.adjustmentIds ?? [])];
  if (commissionIds.length === 0) {
    return {
      kind: "refused",
      code: "invalid_selection",
      message: "Select at least one commission",
    };
  }

  const commissions = await prisma.affiliateCommission.findMany({
    where: { id: { in: commissionIds }, affiliate_id: affiliate.id },
  });
  if (commissions.length !== commissionIds.length) {
    return {
      kind: "refused",
      code: "invalid_selection",
      message: "One or more commissions do not belong to this affiliate",
    };
  }

  for (const commission of commissions) {
    if (commission.state === "paid") {
      return {
        kind: "refused",
        code: "already_paid",
        message: "One or more commissions are already marked paid",
      };
    }
    if (effectiveCommissionState(commission, now) !== "payable") {
      return {
        kind: "refused",
        code: "not_payable",
        message: "One or more commissions are not payable yet",
      };
    }
  }

  const adjustments = adjustmentIds.length
    ? await prisma.affiliateAdjustment.findMany({
        where: { id: { in: adjustmentIds }, affiliate_id: affiliate.id, payout_id: null },
      })
    : [];
  if (adjustments.length !== adjustmentIds.length) {
    return {
      kind: "refused",
      code: "invalid_selection",
      message: "One or more adjustments do not belong to this affiliate or are already paid",
    };
  }

  const commissionTotal = commissions.reduce((sum, row) => sum + row.remaining_cents, 0);
  const adjustmentTotal = adjustments.reduce((sum, row) => sum + row.amount_cents, 0);
  const expected = commissionTotal + adjustmentTotal;
  if (expected !== input.amountCents) {
    return {
      kind: "refused",
      code: "amount_mismatch",
      message: `amountCents must equal selected net (${expected})`,
    };
  }
  if (expected < PAYOUT_MINIMUM_CENTS) {
    return {
      kind: "refused",
      code: "below_minimum",
      message: `Payout requires at least ${PAYOUT_MINIMUM_CENTS} cents payable`,
    };
  }

  const paidAt = input.paidAt && !Number.isNaN(input.paidAt.getTime()) ? input.paidAt : now;
  const currency = commissions[0]?.currency ?? "eur";
  const note = input.referenceNote?.trim() ? input.referenceNote.trim().slice(0, 500) : null;

  try {
    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.affiliatePayout.create({
        data: {
          affiliate_id: affiliate.id,
          amount_cents: expected,
          currency,
          paid_at: paidAt,
          reference_note: note,
          created_by: input.actorUserId,
          idempotency_key: idempotencyKey,
        },
        select: { id: true },
      });
      await tx.affiliateCommission.updateMany({
        where: { id: { in: commissionIds }, state: "pending" },
        data: {
          state: "paid",
          paid_at: paidAt,
          payout_id: created.id,
        },
      });
      if (adjustmentIds.length > 0) {
        await tx.affiliateAdjustment.updateMany({
          where: { id: { in: adjustmentIds }, payout_id: null },
          data: { payout_id: created.id },
        });
      }
      return created;
    });

    return {
      kind: "paid",
      payoutId: payout.id,
      amountCents: expected,
      idempotent: false,
    };
  } catch (err) {
    if (
      idempotencyKey &&
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const existing = await prisma.affiliatePayout.findUnique({
        where: { idempotency_key: idempotencyKey },
        select: { id: true, amount_cents: true },
      });
      if (existing) {
        return {
          kind: "paid",
          payoutId: existing.id,
          amountCents: existing.amount_cents,
          idempotent: true,
        };
      }
    }
    throw err;
  }
}
