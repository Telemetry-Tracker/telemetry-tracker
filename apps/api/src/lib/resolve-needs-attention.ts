/**
 * Founder/admin resolve of OrganizationReferral.needs_attention as VALID.
 * Never creates a Stripe Customer or changes canonical affiliate_id.
 */
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { AUDIT_ACTIONS } from "./audit-log.js";
import { updateExistingCustomerReferralMetadata } from "./affiliate-customer-metadata.js";

export const AFFILIATE_RESOLVE_AUDIT_ACTION =
  AUDIT_ACTIONS.AFFILIATE_NEEDS_ATTENTION_RESOLVE;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveNeedsAttentionInput = {
  organizationId: string;
  actorUserId: string;
  actorEmail: string;
  reason: string;
  confirmAffiliateId?: string;
};

export type ResolveNeedsAttentionResult =
  | {
      kind: "resolved";
      idempotent: boolean;
      fromStatus: string;
      toStatus: string;
      needsAttention: false;
      affiliateId: string | null;
      customerId: string | null;
      stripe: "updated" | "unchanged" | "deferred" | "skipped_deleted";
    }
  | { kind: "not_found" }
  | {
      kind: "refused";
      code: "rejected" | "expired" | "affiliate_mismatch" | "invalid_reason";
      message: string;
    };

function trimReason(raw: string): string | null {
  const reason = raw.trim();
  if (!reason || reason.length > 500) return null;
  return reason;
}

function auditTarget(parts: {
  fromStatus: string;
  toStatus: string;
  fromNeedsAttention: boolean;
  reason: string;
  customerId: string | null;
  stripe: string;
  idempotent: boolean;
}): string {
  return [
    `VALID`,
    `from=${parts.fromStatus}+needs_attention=${parts.fromNeedsAttention}`,
    `to=${parts.toStatus}+needs_attention=false`,
    `reason=${parts.reason}`,
    `customer=${parts.customerId ?? "none"}`,
    `stripe=${parts.stripe}`,
    `idempotent=${parts.idempotent}`,
  ]
    .join(" ")
    .slice(0, 512);
}

export async function resolveNeedsAttentionAsValid(
  prisma: PrismaClient,
  stripe: Stripe | null,
  input: ResolveNeedsAttentionInput
): Promise<ResolveNeedsAttentionResult> {
  const reason = trimReason(input.reason);
  if (!reason) {
    return {
      kind: "refused",
      code: "invalid_reason",
      message: "reason is required (1–500 characters)",
    };
  }

  if (input.confirmAffiliateId && !UUID_RE.test(input.confirmAffiliateId)) {
    return {
      kind: "refused",
      code: "affiliate_mismatch",
      message: "confirmAffiliateId is not a valid affiliate id",
    };
  }

  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, deleted_at: null },
    select: { id: true, stripe_customer_id: true },
  });
  if (!org) return { kind: "not_found" };

  const referral = await prisma.organizationReferral.findUnique({
    where: { organization_id: org.id },
    select: {
      id: true,
      affiliate_id: true,
      status: true,
      needs_attention: true,
      attention_reason: true,
      rewardful_referral_id: true,
      via_token: true,
    },
  });
  if (!referral) return { kind: "not_found" };

  if (referral.status === "REJECTED") {
    return {
      kind: "refused",
      code: "rejected",
      message: "Rejected referrals never receive Rewardful metadata",
    };
  }
  if (referral.status === "EXPIRED") {
    return {
      kind: "refused",
      code: "expired",
      message: "Expired referrals cannot be resolved as valid",
    };
  }

  if (input.confirmAffiliateId) {
    if (!referral.affiliate_id || referral.affiliate_id !== input.confirmAffiliateId) {
      return {
        kind: "refused",
        code: "affiliate_mismatch",
        message: "Canonical affiliate_id cannot be changed after signup",
      };
    }
  }

  const toStatus = referral.affiliate_id ? "ACTIVE" : referral.status;
  const alreadyResolved = !referral.needs_attention && referral.status === toStatus;

  const nextReferral = {
    status: toStatus,
    affiliate_id: referral.affiliate_id,
    needs_attention: false,
    attention_reason: null,
    rewardful_referral_id: referral.rewardful_referral_id,
    via_token: referral.via_token,
  };

  let stripeResult: "updated" | "unchanged" | "deferred" | "skipped_deleted" = "deferred";
  if (!org.stripe_customer_id) {
    stripeResult = "deferred";
  } else if (!stripe) {
    stripeResult = "deferred";
  } else {
    const sync = await updateExistingCustomerReferralMetadata(
      stripe,
      org.id,
      org.stripe_customer_id,
      nextReferral
    );
    if (sync === "skipped_ineligible") stripeResult = "unchanged";
    else if (sync === "skipped_deleted") stripeResult = "skipped_deleted";
    else stripeResult = sync;
  }

  if (!alreadyResolved) {
    await prisma.organizationReferral.update({
      where: { id: referral.id },
      data: {
        needs_attention: false,
        attention_reason: null,
        status: toStatus,
        created_by: input.actorUserId,
      },
    });
  }

  const changed = !alreadyResolved || stripeResult === "updated";
  if (changed) {
    await prisma.organizationAuditEvent.create({
      data: {
        organization_id: org.id,
        actor_user_id: input.actorUserId,
        actor_email: input.actorEmail,
        action: AFFILIATE_RESOLVE_AUDIT_ACTION,
        target: auditTarget({
          fromStatus: referral.status,
          toStatus,
          fromNeedsAttention: referral.needs_attention,
          reason,
          customerId: org.stripe_customer_id,
          stripe: stripeResult,
          idempotent: alreadyResolved,
        }),
      },
    });
  }

  return {
    kind: "resolved",
    idempotent: alreadyResolved,
    fromStatus: referral.status,
    toStatus,
    needsAttention: false,
    affiliateId: referral.affiliate_id,
    customerId: org.stripe_customer_id,
    stripe: stripeResult,
  };
}
