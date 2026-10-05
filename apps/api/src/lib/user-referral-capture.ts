/**
 * Capture user-level referral at registration.
 * Locked permanently; copied to OrganizationReferral when the user creates their first org.
 */
import type { PrismaClient } from "@prisma/client";
import { parseAffiliateCode } from "./affiliate-code.js";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";
import { resolveAffiliate } from "./affiliate-resolution.js";
import { isAffiliateFeatureEnabled } from "./affiliates-feature-flag.js";
import { isReferralExpired } from "./organization-attribution.js";

export type UserReferralCaptureInput = {
  userId: string;
  userEmail: string;
  referralCode?: string;
  /** Last-touch timestamp from cookie/session. Clamped to now if in the future. */
  capturedAt?: string | Date;
};

export type UserReferralCaptureResult =
  | { kind: "not_enabled" }
  | { kind: "no_referral" }
  | { kind: "captured"; userReferralId: string; status: string }
  | { kind: "rejected_self_referral"; reason: string };

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

  if (!affiliate.email_normalized || affiliate.email_normalized.trim() === "") {
    return "Affiliate email unknown";
  }

  const userNormalized = normalizeEmailForSelfReferralCheck(userEmail);
  if (affiliate.email_normalized === userNormalized) {
    return "Self-referral: email matches affiliate";
  }

  return null;
}

function parseCapturedAt(raw: string | Date | undefined): Date {
  const now = new Date();
  if (!raw) return now;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return now;
  if (parsed.getTime() > now.getTime()) return now;
  return parsed;
}

/**
 * Capture referral at user registration (locked permanently).
 * Never throws — registration must not fail.
 */
export async function captureUserReferral(
  prisma: PrismaClient,
  input: UserReferralCaptureInput,
  logger?: { warn: (msg: unknown, context: string) => void }
): Promise<UserReferralCaptureResult> {
  if (!isAffiliateFeatureEnabled()) {
    return { kind: "not_enabled" };
  }

  const code = parseAffiliateCode(input.referralCode ?? "");
  if (!code) {
    if (input.referralCode?.trim() && logger) {
      logger.warn(
        { userId: input.userId },
        "Invalid referral code; ignoring"
      );
    }
    return { kind: "no_referral" };
  }

  try {
    const existing = await prisma.userReferral.findUnique({
      where: { user_id: input.userId },
      select: { id: true },
    });
    if (existing) {
      return { kind: "captured", userReferralId: existing.id, status: "existing" };
    }

    const resolution = await resolveAffiliate(prisma, { referralCode: code });
    if (resolution.kind !== "resolved") {
      return { kind: "no_referral" };
    }

    const affiliateId: string | null = resolution.affiliateId;
    const capturedAt = parseCapturedAt(input.capturedAt);
    const expired = isReferralExpired(capturedAt);

    const selfReferralReason = await checkUserSelfReferral(
      prisma,
      resolution.affiliateId,
      input.userEmail
    );
    if (selfReferralReason === "Affiliate email unknown") {
      if (logger) {
        logger.warn(
          { userId: input.userId, affiliateId },
          "Affiliate email unknown at registration; keeping affiliate bound with unresolved hold"
        );
      }
    } else if (selfReferralReason) {
      return { kind: "rejected_self_referral", reason: selfReferralReason };
    }

    const status = expired ? "EXPIRED" : affiliateId ? "ACTIVE" : "UNRESOLVED";

    const userReferral = await prisma.userReferral.create({
      data: {
        user_id: input.userId,
        affiliate_id: affiliateId,
        referral_code: code,
        source: "link",
        status,
        captured_at: capturedAt,
      },
      select: { id: true },
    });

    return { kind: "captured", userReferralId: userReferral.id, status };
  } catch (err) {
    if (logger) {
      logger.warn({ err, userId: input.userId }, "Failed to capture user referral");
    }
    return { kind: "no_referral" };
  }
}
