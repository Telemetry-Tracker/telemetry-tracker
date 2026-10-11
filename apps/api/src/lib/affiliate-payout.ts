/**
 * Manual founder payouts. No automated money movement.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { effectiveCommissionState } from "./affiliate-commission.js";
import { lockAffiliateForUpdate } from "./affiliate-lock.js";

export const PAYOUT_MINIMUM_CENTS = 5000;

export type AffiliateBalance = {
  pendingCents: number;
  payableCents: number;
  paidCents: number;
  adjustmentCents: number;
  currentPayableBalanceCents: number;
  payoutEligible: boolean;
};

/** Open post-payout clawbacks (and commission-less true balance adjustments). */
export function openPayableAdjustmentWhere(
  affiliateId: string
): Prisma.AffiliateAdjustmentWhereInput {
  return {
    affiliate_id: affiliateId,
    payout_id: null,
    OR: [{ commission_id: null }, { commission: { state: "paid" } }],
  };
}

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
      where: openPayableAdjustmentWhere(affiliateId),
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
    else if (effective === "paid") paidCents += row.remaining_cents;
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

export type MarkPayoutPaidRefuseCode =
  | "below_minimum"
  | "amount_mismatch"
  | "overpay"
  | "not_payable"
  | "already_paid"
  | "invalid_selection"
  | "affiliate_disabled";

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
      code: MarkPayoutPaidRefuseCode;
      message: string;
    };

function refused(code: MarkPayoutPaidRefuseCode, message: string): MarkPayoutPaidResult {
  return { kind: "refused", code, message };
}

class PayoutRowMismatchError extends Error {
  constructor() {
    super("Payout row counts did not match the locked selection");
    this.name = "PayoutRowMismatchError";
  }
}

async function replayIdempotentPayout(
  prisma: PrismaClient | Prisma.TransactionClient,
  affiliateId: string,
  idempotencyKey: string
): Promise<MarkPayoutPaidResult | null> {
  const existing = await prisma.affiliatePayout.findUnique({
    where: { idempotency_key: idempotencyKey },
    select: { id: true, amount_cents: true, affiliate_id: true },
  });
  if (!existing) return null;
  if (existing.affiliate_id !== affiliateId) {
    return refused("invalid_selection", "Idempotency key belongs to another affiliate");
  }
  return {
    kind: "paid",
    payoutId: existing.id,
    amountCents: existing.amount_cents,
    idempotent: true,
  };
}

export async function markAffiliatePayoutPaid(
  prisma: PrismaClient,
  input: MarkPayoutPaidInput,
  now: Date = new Date()
): Promise<MarkPayoutPaidResult> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: input.affiliateId },
    select: { id: true },
  });
  if (!affiliate) return { kind: "not_found" };
  // Disabled affiliates may still be paid already-earned commissions.
  // `affiliate_disabled` stays in the refuse union for callers.

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const replay = await replayIdempotentPayout(prisma, affiliate.id, idempotencyKey);
    if (replay) return replay;
  }

  const commissionIds = [...new Set(input.commissionIds)];
  const requestedAdjustmentIds = [...new Set(input.adjustmentIds ?? [])];
  if (commissionIds.length === 0) {
    return refused("invalid_selection", "Select at least one commission");
  }

  const paidAt = input.paidAt && !Number.isNaN(input.paidAt.getTime()) ? input.paidAt : now;
  const note = input.referenceNote?.trim() ? input.referenceNote.trim().slice(0, 500) : null;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockAffiliateForUpdate(tx, affiliate.id);

      const locked = await tx.affiliate.findUnique({
        where: { id: affiliate.id },
        select: { id: true },
      });
      if (!locked) return { kind: "not_found" as const };

      if (idempotencyKey) {
        const replay = await replayIdempotentPayout(tx, affiliate.id, idempotencyKey);
        if (replay) return replay;
      }

      const commissions = await tx.affiliateCommission.findMany({
        where: { id: { in: commissionIds }, affiliate_id: affiliate.id },
      });
      if (commissions.length !== commissionIds.length) {
        return refused(
          "invalid_selection",
          "One or more commissions do not belong to this affiliate"
        );
      }

      for (const commission of commissions) {
        if (commission.state === "paid") {
          return refused("already_paid", "One or more commissions are already marked paid");
        }
        if (effectiveCommissionState(commission, now) !== "payable") {
          return refused("not_payable", "One or more commissions are not payable yet");
        }
      }

      const openAdjustments = await tx.affiliateAdjustment.findMany({
        where: openPayableAdjustmentWhere(affiliate.id),
      });
      const openIds = new Set(openAdjustments.map((row) => row.id));
      for (const id of requestedAdjustmentIds) {
        if (!openIds.has(id)) {
          return refused(
            "invalid_selection",
            "One or more adjustments do not belong to this affiliate or are already paid"
          );
        }
      }

      const allCommissions = await tx.affiliateCommission.findMany({
        where: { affiliate_id: affiliate.id },
        select: {
          state: true,
          remaining_cents: true,
          payable_at: true,
          dispute_status: true,
        },
      });
      const payableTotal = allCommissions.reduce((sum, row) => {
        return effectiveCommissionState(row, now) === "payable" ? sum + row.remaining_cents : sum;
      }, 0);

      const commissionTotal = commissions.reduce((sum, row) => sum + row.remaining_cents, 0);
      const adjustmentTotal = openAdjustments.reduce((sum, row) => sum + row.amount_cents, 0);
      const expected = commissionTotal + adjustmentTotal;
      const netPayable = payableTotal + adjustmentTotal;

      if (expected !== input.amountCents) {
        return refused(
          "amount_mismatch",
          `amountCents must equal selected commissions plus all unsettled adjustments (${expected}); open clawbacks are auto-included`
        );
      }
      if (input.amountCents > netPayable || expected > netPayable) {
        return refused("overpay", "amountCents exceeds the affiliate's payable balance");
      }
      if (expected < PAYOUT_MINIMUM_CENTS) {
        return refused(
          "below_minimum",
          `Payout requires at least ${PAYOUT_MINIMUM_CENTS} cents payable`
        );
      }

      const currency = commissions[0]?.currency ?? "eur";
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

      const commissionsUpdated = await tx.affiliateCommission.updateMany({
        where: { id: { in: commissionIds }, state: "pending", payout_id: null },
        data: {
          state: "paid",
          paid_at: paidAt,
          payout_id: created.id,
        },
      });
      if (commissionsUpdated.count !== commissionIds.length) {
        throw new PayoutRowMismatchError();
      }

      const openAdjustmentIds = openAdjustments.map((row) => row.id);
      if (openAdjustmentIds.length > 0) {
        const adjustmentsUpdated = await tx.affiliateAdjustment.updateMany({
          where: { id: { in: openAdjustmentIds }, payout_id: null },
          data: { payout_id: created.id },
        });
        if (adjustmentsUpdated.count !== openAdjustmentIds.length) {
          throw new PayoutRowMismatchError();
        }
      }

      return {
        kind: "paid" as const,
        payoutId: created.id,
        amountCents: expected,
        idempotent: false,
      };
    });
  } catch (err) {
    if (err instanceof PayoutRowMismatchError) {
      return refused("already_paid", "One or more commissions were claimed by a concurrent payout");
    }
    if (
      idempotencyKey &&
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const replay = await replayIdempotentPayout(prisma, affiliate.id, idempotencyKey);
      if (replay) return replay;
    }
    throw err;
  }
}
