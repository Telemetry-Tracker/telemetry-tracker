/**
 * Organization attribution: copy from UserReferral and optionally create a Stripe Customer.
 * Always writes OrganizationReferral even if Stripe Customer creation fails.
 * Canonical: one org ≤ one affiliate; locked at first-org claim.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { isAffiliateFeatureEnabled } from "./affiliates-feature-flag.js";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";

export type OrganizationAttributionInput = {
  organizationId: string;
  organizationName: string;
  userId: string;
};

export type OrganizationAttributionResult =
  | { kind: "not_enabled" }
  | { kind: "not_referred" }
  | { kind: "attributed"; referralId: string; customerId: string | null; needsAttention: boolean }
  | { kind: "invitee_not_attributed" }
  | { kind: "rejected_self_referral"; reason: string };

/** Last-touch window (days) from capture to signup. */
export const REFERRAL_ATTRIBUTION_WINDOW_DAYS = 60;

export type ReferralStripeMetadataGate = {
  status: string;
  affiliate_id?: string | null;
  needs_attention?: boolean;
  attention_reason?: string | null;
};

/**
 * Payout hold: withhold commissions and tt_* for self-referral-risk reasons.
 * Not a hold for customer_creation_failed (billing still works; checkout can backfill tt_*).
 */
export function isPayoutHold(referral: {
  attention_reason?: string | null;
}): boolean {
  const reason = referral.attention_reason ?? "";
  return /(?:^|;)(affiliate_email_unknown|no_owner_found_for_self_referral_check|rejected_self_referral)/.test(
    reason
  );
}

/**
 * Checkout session / Customer `tt_org_id` + `tt_affiliate_id`.
 * ACTIVE with a resolved affiliate and not a payout hold.
 */
export function canWriteAffiliateTtMetadata(
  referral: ReferralStripeMetadataGate
): boolean {
  return (
    referral.status === "ACTIVE" &&
    !!referral.affiliate_id &&
    !isPayoutHold(referral)
  );
}

/**
 * Expired only after the window elapses (`>` not `>=`): captured_at exactly 60 days ago is still attributed.
 */
export function isReferralExpired(capturedAt: Date, now: Date = new Date()): boolean {
  const daysSinceCapture = (now.getTime() - capturedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceCapture > REFERRAL_ATTRIBUTION_WINDOW_DAYS;
}

async function resolveStripeCustomerIdWithMetadata(
  prisma: PrismaClient,
  stripe: Stripe,
  orgId: string,
  metadata: {
    organization_id?: string;
    tt_org_id?: string;
    tt_affiliate_id?: string;
  },
  logger?: { warn: (msg: unknown, context: string) => void }
): Promise<{ customerId: string | null; failed: boolean }> {
  const unlocked = await prisma.organization.findFirst({
    where: { id: orgId, deleted_at: null },
    select: { stripe_customer_id: true, name: true },
  });

  if (!unlocked) {
    return { customerId: null, failed: false };
  }

  if (unlocked.stripe_customer_id) {
    return { customerId: unlocked.stripe_customer_id, failed: false };
  }

  const pendingCreate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
    );
    const org = await tx.organization.findFirst({
      where: { id: orgId, deleted_at: null },
      select: { stripe_customer_id: true, name: true },
    });
    if (!org) return null;
    if (org.stripe_customer_id) {
      return { kind: "existing" as const, customerId: org.stripe_customer_id };
    }
    return { kind: "create" as const, orgName: org.name };
  });

  if (!pendingCreate) {
    return { customerId: null, failed: false };
  }

  if (pendingCreate.kind === "existing") {
    return { customerId: pendingCreate.customerId, failed: false };
  }

  try {
    const customer = await stripe.customers.create(
      {
        name: pendingCreate.orgName,
        metadata,
      },
      {
        idempotencyKey: `org_${orgId}_referral`,
      }
    );

    const savedId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
      );
      const org = await tx.organization.findFirst({
        where: { id: orgId, deleted_at: null },
        select: { stripe_customer_id: true },
      });
      if (!org) return null;
      if (org.stripe_customer_id) return org.stripe_customer_id;
      await tx.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: customer.id },
      });
      return customer.id;
    });

    return { customerId: savedId, failed: false };
  } catch (stripeErr) {
    if (logger) {
      logger.warn(
        { err: stripeErr, orgId },
        "Failed to create Stripe Customer for referred organization"
      );
    }
    return { customerId: null, failed: true };
  }
}

/**
 * Attribute organization to affiliate (copy from UserReferral).
 * Always writes OrganizationReferral. If Stripe Customer creation fails, flags for attention.
 * Window is locked at signup: an ACTIVE UserReferral stays ACTIVE even if org is created later.
 */
export async function attributeOrganizationToAffiliate(
  prisma: PrismaClient,
  stripe: Stripe,
  input: OrganizationAttributionInput,
  logger?: { warn: (msg: unknown, context: string) => void; info: (msg: unknown, context: string) => void }
): Promise<OrganizationAttributionResult> {
  if (!isAffiliateFeatureEnabled()) {
    return { kind: "not_enabled" };
  }

  const userReferral = await prisma.userReferral.findUnique({
    where: { user_id: input.userId },
    select: {
      id: true,
      affiliate_id: true,
      referral_code: true,
      source: true,
      status: true,
      captured_at: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!userReferral) {
    return { kind: "not_referred" };
  }

  const claimed = await prisma.userReferral.updateMany({
    where: {
      id: userReferral.id,
      user_id: input.userId,
      attributed_organization_id: null,
    },
    data: {
      attributed_organization_id: input.organizationId,
    },
  });

  if (claimed.count === 0) {
    if (logger) {
      logger.info(
        { userId: input.userId, orgId: input.organizationId },
        "User already has an attributed organization - not attributing second org"
      );
    }
    return { kind: "not_referred" };
  }

  let needsAttention = false;
  let attentionReason: string | null = null;

  if (userReferral.affiliate_id) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: userReferral.affiliate_id },
      select: { email_normalized: true },
    });

    if (affiliate) {
      if (!affiliate.email_normalized || affiliate.email_normalized.trim() === "") {
        needsAttention = true;
        attentionReason = "affiliate_email_unknown";
        if (logger) {
          logger.warn(
            { userId: input.userId, affiliateId: userReferral.affiliate_id },
            "Affiliate email unknown at org attribution"
          );
        }
      } else {
        const userNormalized = normalizeEmailForSelfReferralCheck(userReferral.user.email);
        if (affiliate.email_normalized === userNormalized) {
          if (logger) {
            logger.warn(
              { userId: input.userId, affiliateId: userReferral.affiliate_id },
              "Self-referral rejected at org attribution"
            );
          }

          await prisma.userReferral.updateMany({
            where: {
              id: userReferral.id,
              user_id: input.userId,
            },
            data: {
              status: "REJECTED",
            },
          });

          await prisma.organizationReferral.create({
            data: {
              organization_id: input.organizationId,
              affiliate_id: null,
              referral_code: userReferral.referral_code,
              source: userReferral.source,
              first_seen_at: userReferral.captured_at,
              attributed_at: new Date(),
              status: "REJECTED",
              needs_attention: true,
              attention_reason: "rejected_self_referral",
            },
          });
          return { kind: "rejected_self_referral", reason: "Self-referral: email matches affiliate" };
        }
      }
    } else if (logger) {
      logger.warn(
        { userId: input.userId, affiliateId: userReferral.affiliate_id },
        "Affiliate not found during org attribution self-referral check"
      );
    }
  }

  // Signup lock: honor UserReferral.status when already EXPIRED/REJECTED/ACTIVE.
  // Do not re-open the 60-day window at org creation.
  let referralStatus: "UNRESOLVED" | "ACTIVE" | "EXPIRED" | "REJECTED" = userReferral.status;
  if (userReferral.status !== "EXPIRED" && userReferral.status !== "REJECTED") {
    if (!userReferral.affiliate_id) {
      referralStatus = "UNRESOLVED";
    } else {
      referralStatus = "ACTIVE";
    }
  }
  if (referralStatus === "EXPIRED") {
    needsAttention = true;
    attentionReason = attentionReason
      ? `${attentionReason};referral_expired_${REFERRAL_ATTRIBUTION_WINDOW_DAYS}_days`
      : `referral_expired_${REFERRAL_ATTRIBUTION_WINDOW_DAYS}_days`;
  }

  await prisma.userReferral.updateMany({
    where: {
      id: userReferral.id,
      user_id: input.userId,
    },
    data: {
      status: referralStatus,
    },
  });

  const shouldCreateCustomer = referralStatus === "ACTIVE" || referralStatus === "UNRESOLVED";
  const metadataGate = {
    status: referralStatus,
    affiliate_id: userReferral.affiliate_id,
    needs_attention: needsAttention,
    attention_reason: attentionReason,
  };

  let customerId: string | null = null;
  if (shouldCreateCustomer) {
    const metadata: {
      organization_id: string;
      tt_org_id?: string;
      tt_affiliate_id?: string;
    } = {
      organization_id: input.organizationId,
    };

    if (canWriteAffiliateTtMetadata(metadataGate)) {
      metadata.tt_org_id = input.organizationId;
      metadata.tt_affiliate_id = userReferral.affiliate_id!;
    }

    const customerResult = await resolveStripeCustomerIdWithMetadata(
      prisma,
      stripe,
      input.organizationId,
      metadata,
      logger
    );

    customerId = customerResult.customerId;
    if (customerResult.failed) {
      needsAttention = true;
      attentionReason = attentionReason
        ? `${attentionReason};customer_creation_failed`
        : "customer_creation_failed";
    }
  }

  const orgReferral = await prisma.organizationReferral.create({
    data: {
      organization_id: input.organizationId,
      affiliate_id: userReferral.affiliate_id,
      referral_code: userReferral.referral_code,
      source: userReferral.source,
      first_seen_at: userReferral.captured_at,
      attributed_at: new Date(),
      status: referralStatus,
      needs_attention: needsAttention,
      attention_reason: attentionReason,
    },
    select: { id: true },
  });

  if (logger) {
    logger.info(
      {
        orgId: input.organizationId,
        referralId: orgReferral.id,
        customerId,
        needsAttention,
        attentionReason,
      },
      "Organization attributed to affiliate"
    );
  }

  return {
    kind: "attributed",
    referralId: orgReferral.id,
    customerId,
    needsAttention,
  };
}
