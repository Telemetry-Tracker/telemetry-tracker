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
 * Resolve affiliate deterministically. Never returns a placeholder.
 * If affiliate cannot be resolved, returns "unresolved" so caller can store with affiliate_id=null.
 * 
 * IMPORTANT: Rewardful referral UUIDs are NOT affiliate IDs. They identify referrals, not affiliates.
 * The UUID is stored in UserReferral.rewardful_referral_id and written to Stripe Customer metadata.referral,
 * but it does NOT resolve to an affiliate locally. Only the link token resolves locally via Affiliate.link_token.
 * The referral UUID stays UNRESOLVED until a referral.converted webhook arrives with the affiliate mapping.
 */
export async function resolveAffiliate(
  prisma: PrismaClient,
  input: AffiliateResolutionInput
): Promise<AffiliateResolutionResult> {
  const viaToken = input.viaToken?.trim();
  
  // Try via token (only local resolution method for V1)
  if (viaToken) {
    const affiliateId = await resolveAffiliateFromViaToken(prisma, viaToken);
    if (affiliateId) {
      return { kind: "resolved", affiliateId };
    }
  }

  // If via token didn't resolve and we have a Rewardful UUID, store it for webhook completion
  // The UUID is a REFERRAL identifier, not an AFFILIATE identifier, so it cannot be resolved locally
  
  return {
    kind: "unresolved",
    reason: viaToken
      ? "via_token_not_found"
      : "no_via_token_and_webhook_not_yet_received",
  };
}
