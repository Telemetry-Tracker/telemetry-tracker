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
 * Check if user is trying to refer themselves or if affiliate email is unknown.
 * Returns error string if invalid, null if OK.
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

  // Check if affiliate email is unknown/missing
  if (!affiliate.email_normalized || affiliate.email_normalized.trim() === "") {
    return "Affiliate email unknown";
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
 * Validate via token format (Rewardful link token).
 */
function isValidViaToken(str: string): boolean {
  const viaTokenRegex = /^[A-Za-z0-9_-]{1,64}$/;
  return viaTokenRegex.test(str);
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

  // Validate via token if provided
  const validViaToken = viaToken && isValidViaToken(viaToken) ? viaToken : null;

  // Need at least one valid source
  if (!validRewardfulId && !validViaToken) {
    if (logger) {
      logger.warn(
        { userId: input.userId, invalidRewardfulId: !!rewardfulId, invalidViaToken: !!viaToken },
        "Invalid referral formats; ignoring"
      );
    }
    return { kind: "no_referral" };
  }

  try {
    // Resolve affiliate deterministically from via token
    const viaResolution = validViaToken
      ? await resolveAffiliate(prisma, { viaToken: validViaToken })
      : null;

    // Resolve affiliate from Rewardful UUID (for conflict detection)
    // In V1 we don't call Rewardful API, so we can't resolve from UUID alone yet
    // But we can detect conflicts if via token resolves to a different affiliate
    const rewardfulResolution = validRewardfulId
      ? await resolveAffiliate(prisma, { rewardfulReferralId: validRewardfulId })
      : null;

    // UUID preferred, via token stored as fallback
    let affiliateId: string | null = null;
    
    if (rewardfulResolution?.kind === "resolved") {
      // Prefer UUID if resolved
      affiliateId = rewardfulResolution.affiliateId;
    } else if (viaResolution?.kind === "resolved") {
      // Fallback to via token if UUID not resolved
      affiliateId = viaResolution.affiliateId;
    }

    // Check self-referral if we resolved an affiliate
    if (affiliateId) {
      const selfReferralReason = await checkUserSelfReferral(
        prisma,
        affiliateId,
        input.userEmail
      );
      if (selfReferralReason) {
        return { kind: "rejected_self_referral", reason: selfReferralReason };
      }
    } else {
      // Affiliate not resolved - will be completed by Rewardful webhook later
      if (logger) {
        logger.warn(
          {
            userId: input.userId,
            hasRewardfulId: !!validRewardfulId,
            hasViaToken: !!validViaToken,
          },
          "Affiliate not resolved at registration; will be completed by webhook"
        );
      }
    }

    // Create UserReferral record (affiliate_id may be null)
    // Store both sources for audit trail
    const userReferral = await prisma.userReferral.create({
      data: {
        user_id: input.userId,
        affiliate_id: affiliateId,
        rewardful_referral_id: validRewardfulId,
        via_token: validViaToken,
        source: "link",
        status: affiliateId ? "ACTIVE" : "UNRESOLVED",
        captured_at: new Date(),
      },
      select: { id: true },
    });

    // If needs attention, update the record
    // Note: We don't have a needs_attention field on UserReferral, only on OrganizationReferral
    // So we just log the conflict here and it will be carried forward to OrganizationReferral

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
