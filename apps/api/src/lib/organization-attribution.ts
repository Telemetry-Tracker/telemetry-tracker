/**
 * Organization attribution: copy from UserReferral and create Stripe Customer with metadata.
 * Always writes OrganizationReferral even if Stripe Customer creation fails.
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

/**
 * Check if referral has expired (>55 days since capture).
 */
function isReferralExpired(capturedAt: Date): boolean {
  const daysSinceCapture = (Date.now() - capturedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceCapture > 55;
}

/**
 * Resolve or create Stripe Customer ID with idempotency and proper locking.
 * Uses the existing resolveStripeCustomerId pattern but with affiliate metadata.
 */
async function resolveStripeCustomerIdWithMetadata(
  prisma: PrismaClient,
  stripe: Stripe,
  orgId: string,
  metadata: {
    tt_org_id: string;
    tt_affiliate_id?: string;
    referral?: string;
  },
  logger?: { warn: (msg: unknown, context: string) => void }
): Promise<{ customerId: string | null; failed: boolean }> {
  // Check if Customer already exists
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

  // Need to create Customer - use transaction with row lock
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

  // Create Stripe Customer with idempotency key
  try {
    const customer = await stripe.customers.create({
      name: pendingCreate.orgName,
      metadata,
    }, {
      idempotencyKey: `org_${orgId}_referral`,
    });

    // Save Customer ID with locking
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

  // Check if user has a referral record
  const userReferral = await prisma.userReferral.findUnique({
    where: { user_id: input.userId },
    select: {
      affiliate_id: true,
      rewardful_referral_id: true,
      via_token: true,
      source: true,
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

  // Only first org as OWNER is attributed
  // Check if user already has an attributed org (even if deleted) to enforce first-org-only rule
  const existingAttribution = await prisma.organizationReferral.findFirst({
    where: {
      affiliate_id: { not: null }, // Only count attributed referrals
      organization: {
        // Note: we check ALL orgs (including soft-deleted) to enforce first-org-only rule
        // so delete-and-recreate can't re-attribute
        memberships: {
          some: {
            user_id: input.userId,
            role: "OWNER",
          },
        },
      },
    },
    select: { id: true, organization_id: true },
  });

  if (existingAttribution) {
    // User already has an attributed org (even if deleted) - don't attribute
    if (logger) {
      logger.info(
        { userId: input.userId, orgId: input.organizationId, existingOrgId: existingAttribution.organization_id },
        "User already has an attributed organization - not attributing second org"
      );
    }
    return { kind: "not_referred" };
  }

  // Initialize needs_attention tracking
  let needsAttention = false;
  let attentionReason: string | null = null;

  // Self-referral and affiliate email validation
  if (userReferral.affiliate_id) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: userReferral.affiliate_id },
      select: { email_normalized: true },
    });

    if (affiliate) {
      // Check if affiliate email is unknown/missing
      if (!affiliate.email_normalized || affiliate.email_normalized.trim() === "") {
        // Unknown affiliate email - flag for attention but continue
        needsAttention = true;
        attentionReason = "affiliate_email_unknown";
        if (logger) {
          logger.warn(
            { userId: input.userId, affiliateId: userReferral.affiliate_id },
            "Affiliate email unknown at org attribution"
          );
        }
      } else {
        // Check self-referral
        const userNormalized = normalizeEmailForSelfReferralCheck(userReferral.user.email);
        if (affiliate.email_normalized === userNormalized) {
          // Self-referral detected at org creation
          if (logger) {
            logger.warn(
              { userId: input.userId, affiliateId: userReferral.affiliate_id },
              "Self-referral rejected at org attribution"
            );
          }
          // Create OrganizationReferral with rejection reason
          await prisma.organizationReferral.create({
            data: {
              organization_id: input.organizationId,
              affiliate_id: null,
              rewardful_referral_id: userReferral.rewardful_referral_id,
              via_token: userReferral.via_token,
              source: userReferral.source,
              first_seen_at: userReferral.captured_at,
              attributed_at: new Date(),
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

  // Check if referral has expired (55-day rule)
  const expired = isReferralExpired(userReferral.captured_at);
  if (expired) {
    needsAttention = true;
    attentionReason = "referral_expired_55_days";
  } else if (!userReferral.affiliate_id) {
    needsAttention = true;
    attentionReason = "affiliate_unresolved";
  }

  // UUID/via conflict check
  if (userReferral.rewardful_referral_id && userReferral.via_token) {
    needsAttention = true;
    attentionReason = attentionReason ? `${attentionReason};uuid_via_conflict` : "uuid_via_conflict";
  }

  // Create Stripe Customer if:
  // 1. Referral has not expired (55-day rule)
  // 2. We have a UUID (affiliate may be unresolved) OR we have via token + resolved affiliate
  const hasUuid = !!userReferral.rewardful_referral_id;
  const hasResolvedViaToken = !!userReferral.via_token && !!userReferral.affiliate_id;
  const shouldCreateCustomer = !expired && (hasUuid || hasResolvedViaToken);

  // Create Stripe Customer if conditions are met
  let customerId: string | null = null;
  if (shouldCreateCustomer) {
    const metadata: {
      organization_id: string;
      tt_org_id: string;
      tt_affiliate_id?: string;
      referral?: string;
    } = {
      organization_id: input.organizationId,
      tt_org_id: input.organizationId,
    };

    // Add affiliate_id if resolved
    if (userReferral.affiliate_id) {
      metadata.tt_affiliate_id = userReferral.affiliate_id;
    }

    // Always prefer UUID; use via token only when no UUID and affiliate resolved
    if (userReferral.rewardful_referral_id) {
      metadata.referral = userReferral.rewardful_referral_id;
    } else if (userReferral.via_token && userReferral.affiliate_id) {
      metadata.referral = userReferral.via_token;
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

  // Always create OrganizationReferral record
  const orgReferral = await prisma.organizationReferral.create({
    data: {
      organization_id: input.organizationId,
      affiliate_id: userReferral.affiliate_id,
      rewardful_referral_id: userReferral.rewardful_referral_id,
      via_token: userReferral.via_token,
      source: userReferral.source,
      first_seen_at: userReferral.captured_at,
      attributed_at: new Date(),
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
