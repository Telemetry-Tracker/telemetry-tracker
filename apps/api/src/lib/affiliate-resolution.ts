/**
 * Deterministic affiliate resolution from via token or Rewardful API.
 * Never uses placeholder/arbitrary affiliate assignment.
 */
import type { PrismaClient } from "@prisma/client";

export type AffiliateResolutionInput = {
  /** Via token from URL query param (?via=alice) */
  viaToken?: string;
  /** Rewardful referral UUID from Rewardful.referral */
  rewardfulReferralId?: string;
};

export type AffiliateResolutionResult =
  | { kind: "resolved"; affiliateId: string }
  | { kind: "unresolved"; reason: string };

/**
 * Resolve affiliate ID deterministically from via token.
 * Returns null if affiliate cannot be found or token is invalid.
 */
async function resolveAffiliateFromViaToken(
  prisma: PrismaClient,
  viaToken: string
): Promise<string | null> {
  const affiliate = await prisma.affiliate.findFirst({
    where: {
      link_token: viaToken,
      state: "active",
    },
    select: { id: true },
  });
  return affiliate?.id ?? null;
}

/**
 * Resolve affiliate from Rewardful UUID (match against rewardful_affiliate_id).
 */
async function resolveAffiliateFromUUID(
  prisma: PrismaClient,
  rewardfulReferralId: string
): Promise<string | null> {
  const affiliate = await prisma.affiliate.findFirst({
    where: {
      rewardful_affiliate_id: rewardfulReferralId,
      state: "active",
    },
    select: { id: true },
  });
  return affiliate?.id ?? null;
}

/**
 * Resolve affiliate deterministically. Never returns a placeholder.
 * If affiliate cannot be resolved, returns "unresolved" so caller can store with affiliate_id=null.
 */
export async function resolveAffiliate(
  prisma: PrismaClient,
  input: AffiliateResolutionInput
): Promise<AffiliateResolutionResult> {
  const viaToken = input.viaToken?.trim();
  const rewardfulId = input.rewardfulReferralId?.trim();
  
  // Try Rewardful UUID first (most authoritative)
  if (rewardfulId) {
    const affiliateId = await resolveAffiliateFromUUID(prisma, rewardfulId);
    if (affiliateId) {
      return { kind: "resolved", affiliateId };
    }
  }
  
  // Fallback to via token
  if (viaToken) {
    const affiliateId = await resolveAffiliateFromViaToken(prisma, viaToken);
    if (affiliateId) {
      return { kind: "resolved", affiliateId };
    }
  }

  // Neither resolved
  return {
    kind: "unresolved",
    reason: rewardfulId
      ? "uuid_not_found"
      : viaToken
      ? "via_token_not_found"
      : "no_referral_data",
  };
}
