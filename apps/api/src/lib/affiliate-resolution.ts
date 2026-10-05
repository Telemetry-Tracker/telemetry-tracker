/**
 * Deterministic affiliate resolution from a public referral code.
 * Only approved/active affiliates resolve.
 */
import type { PrismaClient } from "@prisma/client";
import { parseAffiliateCode } from "./affiliate-code.js";

export type AffiliateResolutionInput = {
  referralCode?: string;
};

export type AffiliateResolutionResult =
  | { kind: "resolved"; affiliateId: string; code: string }
  | { kind: "unresolved"; reason: string };

export async function resolveAffiliate(
  prisma: PrismaClient,
  input: AffiliateResolutionInput
): Promise<AffiliateResolutionResult> {
  const code = parseAffiliateCode(input.referralCode ?? "");
  if (!code) {
    return { kind: "unresolved", reason: "invalid_referral_code" };
  }

  const affiliate = await prisma.affiliate.findFirst({
    where: { code, state: "active" },
    select: { id: true },
  });
  if (!affiliate) {
    return { kind: "unresolved", reason: "affiliate_code_not_found" };
  }
  return { kind: "resolved", affiliateId: affiliate.id, code };
}
