/**
 * Affiliate attribution during signup.
 * Creates Stripe Customer and OrganizationReferral for referred signups.
 */
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";
import { isAffiliateFeatureEnabled } from "./affiliates-feature-flag.js";

export type SignupAttributionInput = {
  organizationId: string;
  organizationName: string;
  userEmail: string;
  /** Rewardful referral UUID from Rewardful.referral */
  rewardfulReferralId?: string;
  /** via token from URL query param */
  viaToken?: string;
};

export type SignupAttributionResult =
  | { kind: "not_enabled" }
  | { kind: "no_referral" }
  | { kind: "attributed"; referralId: string; customerId: string }
  | { kind: "rejected_self_referral"; reason: string }
  | { kind: "failed"; error: string };

/**
 * Check if affiliate attribution should be attempted for this signup.
 * Returns null if no attribution needed, otherwise returns attribution details.
 */
async function resolveAttribution(
  prisma: PrismaClient,
  input: SignupAttributionInput
): Promise<{
  affiliateId: string;
  rewardfulReferralId: string | null;
  viaToken: string | null;
  source: "link" | "manual";
} | null> {
  const rewardfulId = input.rewardfulReferralId?.trim() || null;
  const viaToken = input.viaToken?.trim() || null;

  // Need at least one referral source
  if (!rewardfulId && !viaToken) {
    return null;
  }

  // Prefer Rewardful UUID if available (most reliable)
  if (rewardfulId) {
    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(rewardfulId)) {
      // Invalid UUID, try via token fallback
      if (!viaToken) {
        return null;
      }
    } else {
      // Valid UUID - we don't have the affiliate ID yet, but that's OK
      // We'll create the referral and Rewardful webhook will link it later
      // For now, mark as needing attention if we can't find the affiliate
      const affiliate = await prisma.affiliate.findFirst({
        where: { state: "active" },
        select: { id: true },
        take: 1,
      });

      if (affiliate) {
        // Use first active affiliate as placeholder (webhook will correct)
        return {
          affiliateId: affiliate.id,
          rewardfulReferralId: rewardfulId,
          viaToken: viaToken,
          source: "link",
        };
      }
      // Fall through to via token if no affiliates exist yet
    }
  }

  // Try via token lookup
  if (viaToken) {
    const affiliate = await prisma.affiliate.findFirst({
      where: {
        link_token: viaToken,
        state: "active",
      },
      select: { id: true },
    });

    if (affiliate) {
      return {
        affiliateId: affiliate.id,
        rewardfulReferralId: rewardfulId,
        viaToken: viaToken,
        source: "link",
      };
    }
  }

  // No valid attribution found
  return null;
}

/**
 * Check if signup is a self-referral.
 * Returns null if OK, or reason string if rejected.
 */
async function checkSelfReferral(
  prisma: PrismaClient,
  affiliateId: string,
  userEmail: string,
  organizationId: string
): Promise<string | null> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { email_normalized: true },
  });

  if (!affiliate) {
    return "Affiliate not found";
  }

  const userNormalized = normalizeEmailForSelfReferralCheck(userEmail);

  // Check email match
  if (affiliate.email_normalized === userNormalized) {
    return "Self-referral: email matches affiliate";
  }

  // Check if affiliate is a member of the new organization
  // (This is tricky: the org was just created, so there are no memberships yet.
  // We'll check if the creating user would be creating an org they're already in,
  // which doesn't apply to new orgs. Skip this check for V1.)

  return null; // OK
}

/**
 * Attempt to attribute signup to affiliate.
 * Creates Stripe Customer with metadata and OrganizationReferral record.
 * Never throws - returns result indicating success or failure reason.
 */
export async function attributeSignupToAffiliate(
  prisma: PrismaClient,
  stripe: Stripe,
  input: SignupAttributionInput
): Promise<SignupAttributionResult> {
  // Check feature flag
  if (!isAffiliateFeatureEnabled()) {
    return { kind: "not_enabled" };
  }

  try {
    // Resolve attribution
    const attribution = await resolveAttribution(prisma, input);
    if (!attribution) {
      return { kind: "no_referral" };
    }

    // Check self-referral
    const selfReferralReason = await checkSelfReferral(
      prisma,
      attribution.affiliateId,
      input.userEmail,
      input.organizationId
    );
    if (selfReferralReason) {
      return { kind: "rejected_self_referral", reason: selfReferralReason };
    }

    // Create Stripe Customer with metadata
    let customerId: string;
    try {
      const customer = await stripe.customers.create({
        name: input.organizationName,
        email: input.userEmail,
        metadata: {
          tt_org_id: input.organizationId,
          tt_affiliate_id: attribution.affiliateId,
          ...(attribution.rewardfulReferralId
            ? { referral: attribution.rewardfulReferralId }
            : {}),
        },
      });
      customerId = customer.id;
    } catch (stripeErr) {
      // Log but don't fail signup
      console.error(
        { err: stripeErr, orgId: input.organizationId },
        "Failed to create Stripe Customer for referred signup"
      );
      return {
        kind: "failed",
        error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      };
    }

    // Update organization with customer ID
    await prisma.organization.update({
      where: { id: input.organizationId },
      data: { stripe_customer_id: customerId },
    });

    // Create OrganizationReferral record
    const referral = await prisma.organizationReferral.create({
      data: {
        organization_id: input.organizationId,
        affiliate_id: attribution.affiliateId,
        rewardful_referral_id: attribution.rewardfulReferralId,
        via_token: attribution.viaToken,
        source: attribution.source,
        first_seen_at: new Date(), // Actual click time would be better, but not available
        attributed_at: new Date(),
      },
      select: { id: true },
    });

    return { kind: "attributed", referralId: referral.id, customerId };
  } catch (err) {
    // Catch-all: log and return failure
    console.error(
      { err, orgId: input.organizationId },
      "Unexpected error in affiliate attribution"
    );
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
