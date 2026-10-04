/**
 * Capture user-level referral at registration.
 * This is locked permanently and copied to OrganizationReferral when user creates an org.
 */
import type { PrismaClient } from "@prisma/client";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";
import { resolveAffiliate } from "./affiliate-resolution.js";
import { isAffiliateFeatureEnabled } from "./affiliates-feature-flag.js";

export type UserReferralCaptureInput = {
  userId: string;
  userEmail: string;
  rewardfulReferralId?: string;
  viaToken?: string;
};

export type UserReferralCaptureResult =
  | { kind: "not_enabled" }
  | { kind: "no_referral" }
  | { kind: "captured"; userReferralId: string }
  | { kind: "rejected_self_referral"; reason: string };

/**
 * Check if user is trying to refer themselves.
 */
async function checkUserSelfReferral(
  prisma: PrismaClient,
  affiliateId: string,
  userEmail: string
): Promise<string | null> {
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { email_normalized: true },
  });

  if (!affiliate) {
    return "Affiliate not found";
  }

  const userNormalized = normalizeEmailForSelfReferralCheck(userEmail);
  if (affiliate.email_normalized === userNormalized) {
    return "Self-referral: email matches affiliate";
  }

  return null; // OK
}

/**
 * Validate Rewardful referral UUID format.
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Capture referral at user registration (locked permanently).
 * Never throws - returns result indicating outcome.
 */
export async function captureUserReferral(
  prisma: PrismaClient,
  input: UserReferralCaptureInput,
  logger?: { warn: (msg: unknown, context: string) => void }
): Promise<UserReferralCaptureResult> {
  if (!isAffiliateFeatureEnabled()) {
    return { kind: "not_enabled" };
  }

  const rewardfulId = input.rewardfulReferralId?.trim();
  const viaToken = input.viaToken?.trim();

  // Need at least one referral source
  if (!rewardfulId && !viaToken) {
    return { kind: "no_referral" };
  }

  // Validate Rewardful UUID if provided
  const validRewardfulId = rewardfulId && isValidUUID(rewardfulId) ? rewardfulId : null;

  try {
    // Resolve affiliate deterministically
    const resolution = await resolveAffiliate(prisma, {
      viaToken,
      rewardfulReferralId: validRewardfulId ?? undefined,
    });

    let affiliateId: string | null = null;
    if (resolution.kind === "resolved") {
      // Check self-referral
      const selfReferralReason = await checkUserSelfReferral(
        prisma,
        resolution.affiliateId,
        input.userEmail
      );
      if (selfReferralReason) {
        return { kind: "rejected_self_referral", reason: selfReferralReason };
      }
      affiliateId = resolution.affiliateId;
    } else {
      // Affiliate not resolved - will be completed by Rewardful webhook later
      if (logger) {
        logger.warn(
          {
            userId: input.userId,
            reason: resolution.reason,
            hasRewardfulId: !!validRewardfulId,
            hasViaToken: !!viaToken,
          },
          "Affiliate not resolved at registration; will be completed by webhook"
        );
      }
    }

    // Create UserReferral record (affiliate_id may be null)
    const userReferral = await prisma.userReferral.create({
      data: {
        user_id: input.userId,
        affiliate_id: affiliateId,
        rewardful_referral_id: validRewardfulId,
        via_token: viaToken ?? null,
        source: "link",
        captured_at: new Date(),
      },
      select: { id: true },
    });

    return { kind: "captured", userReferralId: userReferral.id };
  } catch (err) {
    if (logger) {
      logger.warn(
        { err, userId: input.userId },
        "Failed to capture user referral"
      );
    }
    // Don't fail registration
    return { kind: "no_referral" };
  }
}
