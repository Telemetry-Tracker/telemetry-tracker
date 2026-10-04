/**
 * Rewardful webhook handler (`POST /webhooks/rewardful`).
 * Registered only when AFFILIATES_ENABLED=true and REWARDFUL_WEBHOOK_SECRET is set.
 * 
 * Payload structure: { object, event: { id, type }, request }
 * Docs: https://developers.rewardful.com/webhooks/requests
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { verifyRewardfulSignature } from "../lib/rewardful-webhook-signature.js";
import {
  dedupeWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
} from "../lib/webhook-dedupe.js";
import { normalizeEmailForSelfReferralCheck } from "../lib/affiliate-email-normalize.js";

// Rewardful webhook payload schemas
// Base event structure (all events have this)
const RewardfulWebhookEventSchema = z.object({
  event: z.object({
    id: z.string(),
    type: z.string(),
  }),
  object: z.unknown(), // Parse per event type
});

type RewardfulWebhookEvent = z.infer<typeof RewardfulWebhookEventSchema>;

// Event-specific object schemas with .passthrough() to preserve extra fields
const RewardfulAffiliateSchema = z.object({
  id: z.string(),
  state: z.enum(["active", "suspended"]).nullish(),
  email: z.string().nullish(),
  links: z.array(z.object({ token: z.string().nullish() }).passthrough()).nullish(),
}).passthrough();

const RewardfulReferralSchema = z.object({
  id: z.string(),
  conversion_state: z.string().nullish(), // "pending", "converted", "expired"
  stripe_customer_id: z.string().nullish(),
  created: z.string().nullish(),
  // Affiliate can be nested in object or in sale
  affiliate: z.object({ id: z.string() }).passthrough().nullish(),
}).passthrough();

const RewardfulCommissionSchema = z.object({
  id: z.string(),
  amount: z.number().nullish(), // cents
  currency: z.string().nullish(),
  state: z.string().nullish(),
  due_at: z.string().nullish(),
  paid_at: z.string().nullish(),
  voided_at: z.string().nullish(),
  sale: z.object({
    stripe_charge_id: z.string().nullish(),
    affiliate: z.object({ id: z.string() }).passthrough().nullish(),
  }).passthrough().nullish(),
}).passthrough();

const RewardfulPayoutSchema = z.object({
  id: z.string(),
  amount: z.number().nullish(), // cents
  currency: z.string().nullish(),
  state: z.string().nullish(),
  paid_at: z.string().nullish(),
  affiliate: z.object({ id: z.string() }).passthrough().nullish(),
}).passthrough();

/**
 * Upsert Affiliate mirror from Rewardful webhook.
 */
async function upsertAffiliate(affiliateData: z.infer<typeof RewardfulAffiliateSchema>) {
  const email = affiliateData.email?.trim();
  const emailNormalized = email ? normalizeEmailForSelfReferralCheck(email) : null;
  const linkToken = affiliateData.links?.[0]?.token ?? null;

  await prisma.affiliate.upsert({
    where: { rewardful_affiliate_id: affiliateData.id },
    create: {
      rewardful_affiliate_id: affiliateData.id,
      link_token: linkToken,
      email_normalized: emailNormalized,
      state: affiliateData.state ?? "active",
    },
    update: {
      link_token: linkToken ?? undefined,
      email_normalized: emailNormalized === null ? undefined : emailNormalized,
      state: affiliateData.state ?? undefined,
    },
  });
}

/**
 * Complete unresolved UserReferral or OrganizationReferral with affiliate_id.
 * Checks for self-referral before completing.
 * Never completes or clears needs_attention on expired or rejected referrals.
 */
async function completeUnresolvedReferrals(
  affiliateId: string,
  rewardfulReferralId: string,
  logger?: { info: (msg: unknown, context: string) => void; warn: (msg: unknown, context: string) => void }
) {
  // Get affiliate email for self-referral check
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: { email_normalized: true },
  });

  if (!affiliate) {
    if (logger) {
      logger.warn(
        { affiliateId, rewardfulReferralId },
        "Affiliate not found when completing unresolved referrals"
      );
    }
    return;
  }

  // Check if affiliate email is null (needs attention for self-referral check)
  if (!affiliate.email_normalized) {
    // Can't check self-referral without email - flag for attention
    const updatedUsers = await prisma.userReferral.updateMany({
      where: {
        rewardful_referral_id: rewardfulReferralId,
        affiliate_id: null,
      },
      data: { affiliate_id: affiliateId },
    });

    // For orgs, set needs_attention since we can't verify self-referral
    const updatedOrgs = await prisma.organizationReferral.updateMany({
      where: {
        rewardful_referral_id: rewardfulReferralId,
        affiliate_id: null,
      },
      data: {
        affiliate_id: affiliateId,
        needs_attention: true,
        attention_reason: "affiliate_email_unknown_cannot_verify_self_referral",
      },
    });

    if ((updatedUsers.count > 0 || updatedOrgs.count > 0) && logger) {
      logger.warn(
        { affiliateId, rewardfulReferralId, userCount: updatedUsers.count, orgCount: updatedOrgs.count },
        "Completed unresolved referrals but affiliate email is unknown (needs attention for self-referral check)"
      );
    }
    return;
  }

  // Get all unresolved UserReferrals with this Rewardful ID
  const unresolvedUsers = await prisma.userReferral.findMany({
    where: {
      rewardful_referral_id: rewardfulReferralId,
      affiliate_id: null,
    },
    select: {
      id: true,
      user_id: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  let completedUsers = 0;
  let rejectedUsers = 0;

  for (const userReferral of unresolvedUsers) {
    const { normalizeEmailForSelfReferralCheck } = await import("../lib/affiliate-email-normalize.js");
    const userNormalized = normalizeEmailForSelfReferralCheck(userReferral.user.email);

    if (affiliate.email_normalized === userNormalized) {
      // Self-referral - don't complete
      rejectedUsers++;
      if (logger) {
        logger.warn(
          { userId: userReferral.user_id, affiliateId, rewardfulReferralId },
          "Self-referral rejected in webhook completion"
        );
      }
    } else {
      // Complete this UserReferral
      await prisma.userReferral.updateMany({
        where: {
          id: userReferral.id,
          affiliate_id: null,
        },
        data: { affiliate_id: affiliateId },
      });
      completedUsers++;
    }
  }

  // Get all unresolved OrganizationReferrals with this Rewardful ID
  // Never complete or clear needs_attention on expired or rejected referrals
  const unresolvedOrgs = await prisma.organizationReferral.findMany({
    where: {
      rewardful_referral_id: rewardfulReferralId,
      affiliate_id: null,
      OR: [
        { needs_attention: false },
        { needs_attention: true, NOT: { attention_reason: { contains: "expired" } } },
      ],
    },
    select: {
      id: true,
      organization_id: true,
      needs_attention: true,
      attention_reason: true,
      first_seen_at: true,
      organization: {
        select: {
          memberships: {
            where: {
              role: "OWNER",
            },
            select: {
              user: {
                select: {
                  email: true,
                },
              },
            },
            take: 1,
          },
        },
      },
    },
  });

  let completedOrgs = 0;
  let rejectedOrgs = 0;
  let skippedExpired = 0;
  let skippedRejected = 0;

  for (const orgReferral of unresolvedOrgs) {
    // Skip expired referrals
    if (orgReferral.first_seen_at) {
      const daysSinceCapture = (Date.now() - orgReferral.first_seen_at.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCapture > 55) {
        skippedExpired++;
        if (logger) {
          logger.warn(
            { orgId: orgReferral.organization_id, affiliateId, rewardfulReferralId, daysSinceCapture },
            "Skipping completion of expired referral (>55 days)"
          );
        }
        continue;
      }
    }

    // Skip already-rejected referrals
    if (orgReferral.needs_attention && orgReferral.attention_reason?.includes("rejected")) {
      skippedRejected++;
      if (logger) {
        logger.warn(
          { orgId: orgReferral.organization_id, affiliateId, rewardfulReferralId, reason: orgReferral.attention_reason },
          "Skipping completion of rejected referral"
        );
      }
      continue;
    }

    const ownerEmail = orgReferral.organization.memberships[0]?.user.email;
    if (!ownerEmail) {
      // No owner found - flag for attention
      await prisma.organizationReferral.updateMany({
        where: {
          id: orgReferral.id,
          affiliate_id: null,
        },
        data: {
          affiliate_id: affiliateId,
          needs_attention: true,
          attention_reason: "no_owner_found_for_self_referral_check",
        },
      });
      completedOrgs++;
      continue;
    }

    const { normalizeEmailForSelfReferralCheck } = await import("../lib/affiliate-email-normalize.js");
    const ownerNormalized = normalizeEmailForSelfReferralCheck(ownerEmail);

    if (affiliate.email_normalized === ownerNormalized) {
      // Self-referral - reject by setting needs_attention
      await prisma.organizationReferral.updateMany({
        where: {
          id: orgReferral.id,
          affiliate_id: null,
        },
        data: {
          affiliate_id: null, // Don't set affiliate_id for self-referral
          needs_attention: true,
          attention_reason: "rejected_self_referral",
        },
      });
      rejectedOrgs++;
      if (logger) {
        logger.warn(
          { orgId: orgReferral.organization_id, affiliateId, rewardfulReferralId },
          "Self-referral rejected for organization in webhook completion"
        );
      }
    } else {
      // Complete this OrganizationReferral
      await prisma.organizationReferral.updateMany({
        where: {
          id: orgReferral.id,
          affiliate_id: null,
        },
        data: {
          affiliate_id: affiliateId,
          needs_attention: false,
          attention_reason: null,
        },
      });
      completedOrgs++;
    }
  }

  if ((completedUsers > 0 || completedOrgs > 0 || rejectedUsers > 0 || rejectedOrgs > 0 || skippedExpired > 0 || skippedRejected > 0) && logger) {
    logger.info(
      {
        affiliateId,
        rewardfulReferralId,
        completedUsers,
        rejectedUsers,
        completedOrgs,
        rejectedOrgs,
        skippedExpired,
        skippedRejected,
      },
      "Completed unresolved referrals via Rewardful webhook"
    );
  }
}

/**
 * Link referral to organization via Stripe customer ID.
 * Uses guarded updateMany to prevent overwriting existing rewardful_referral_id.
 */
async function linkReferralToOrganization(
  stripeCustomerId: string,
  rewardfulReferralId: string,
  logger?: { warn: (msg: unknown, context: string) => void }
) {
  // Find organization by Stripe customer ID
  const org = await prisma.organization.findFirst({
    where: { stripe_customer_id: stripeCustomerId, deleted_at: null },
    select: { id: true },
  });

  if (!org) {
    if (logger) {
      logger.warn(
        { stripeCustomerId, rewardfulReferralId },
        "Rewardful referral for unknown Stripe customer - not creating TT attribution"
      );
    }
    return;
  }

  // Check if org already has attribution
  const existing = await prisma.organizationReferral.findUnique({
    where: { organization_id: org.id },
    select: { id: true, rewardful_referral_id: true },
  });

  if (existing) {
    // Update rewardful_referral_id only if missing (guarded)
    if (!existing.rewardful_referral_id && rewardfulReferralId) {
      await prisma.organizationReferral.updateMany({
        where: {
          organization_id: org.id,
          rewardful_referral_id: null,
        },
        data: { rewardful_referral_id: rewardfulReferralId },
      });
    }
  } else {
    // No TT attribution but Rewardful reports conversion - flag for founder attention
    if (logger) {
      logger.warn(
        { orgId: org.id, stripeCustomerId, rewardfulReferralId },
        "Rewardful conversion for org without TT attribution - needs founder attention"
      );
    }
  }
}

/**
 * Upsert Commission mirror from Rewardful webhook.
 */
async function upsertCommission(commissionData: z.infer<typeof RewardfulCommissionSchema>) {
  // Find affiliate by Rewardful ID - check object.affiliate or sale.affiliate
  const affiliateRewardfulId = commissionData.affiliate?.id ?? commissionData.sale?.affiliate?.id;
  const affiliate = affiliateRewardfulId
    ? await prisma.affiliate.findFirst({
        where: { rewardful_affiliate_id: affiliateRewardfulId },
        select: { id: true },
      })
    : null;

  // Organization ID lookup via charge not implemented in V1
  const organizationId: string | null = null;

  await prisma.affiliateCommission.upsert({
    where: { rewardful_commission_id: commissionData.id },
    create: {
      rewardful_commission_id: commissionData.id,
      affiliate_id: affiliate?.id ?? null,
      organization_id: organizationId,
      stripe_charge_id: commissionData.sale?.stripe_charge_id ?? null,
      amount_cents: commissionData.amount ?? 0,
      currency: commissionData.currency ?? "USD",
      state: commissionData.state ?? "pending",
      due_at: commissionData.due_at ? new Date(commissionData.due_at) : null,
      paid_at: commissionData.paid_at ? new Date(commissionData.paid_at) : null,
      voided_at: commissionData.voided_at ? new Date(commissionData.voided_at) : null,
    },
    update: {
      affiliate_id: affiliate?.id ?? undefined,
      state: commissionData.state ?? undefined,
      amount_cents: commissionData.amount ?? undefined,
      currency: commissionData.currency ?? undefined,
      stripe_charge_id: commissionData.sale?.stripe_charge_id ?? undefined,
      due_at: commissionData.due_at ? new Date(commissionData.due_at) : undefined,
      paid_at: commissionData.paid_at ? new Date(commissionData.paid_at) : undefined,
      voided_at: commissionData.voided_at ? new Date(commissionData.voided_at) : (commissionData.state === "voided" ? new Date() : undefined),
    },
  });
}

/**
 * Mirror payout (never move money, just record for audit).
 */
async function mirrorPayout(
  payoutData: z.infer<typeof RewardfulPayoutSchema>,
  logger: { info: (msg: unknown, context: string) => void }
) {
  const affiliate = payoutData.affiliate?.id
    ? await prisma.affiliate.findFirst({
        where: { rewardful_affiliate_id: payoutData.affiliate.id },
        select: { id: true },
      })
    : null;

  logger.info(
    {
      payoutId: payoutData.id,
      affiliateId: affiliate?.id,
      amount: payoutData.amount,
      currency: payoutData.currency,
      state: payoutData.state,
    },
    "Rewardful payout mirrored (audit only, no money movement)"
  );
}

/**
 * Process Rewardful webhook event.
 */
async function processRewardfulEvent(
  event: RewardfulWebhookEvent,
  logger: { info: (msg: unknown, context: string) => void; warn: (msg: unknown, context: string) => void }
): Promise<void> {
  switch (event.event.type) {
    case "affiliate.created":
    case "affiliate.updated": {
      const parsed = RewardfulAffiliateSchema.safeParse(event.object);
      if (parsed.success) {
        await upsertAffiliate(parsed.data);
      }
      break;
    }

    case "referral.lead":
    case "referral.created":
    case "referral.converted": {
      const parsed = RewardfulReferralSchema.safeParse(event.object);
      if (!parsed.success) break;
      
      const referralData = parsed.data;
      
      // Complete unresolved referrals (for converted events)
      if (event.event.type === "referral.converted" && referralData.affiliate?.id && referralData.id) {
        const affiliate = await prisma.affiliate.findFirst({
          where: { rewardful_affiliate_id: referralData.affiliate.id },
          select: { id: true },
        });
        if (affiliate) {
          await completeUnresolvedReferrals(affiliate.id, referralData.id, logger);
        }
      }

      // Link to organization if Stripe customer is known (for converted events)
      if (event.event.type === "referral.converted" && referralData.stripe_customer_id && referralData.id) {
        await linkReferralToOrganization(referralData.stripe_customer_id, referralData.id, logger);
      }
      
      // Log lead events for audit
      if (event.event.type === "referral.lead") {
        logger.info({ referralId: referralData.id }, "Rewardful referral.lead received");
      }
      break;
    }

    case "commission.created":
    case "commission.updated":
    case "commission.paid":
    case "commission.voided": {
      const parsed = RewardfulCommissionSchema.safeParse(event.object);
      if (parsed.success) {
        await upsertCommission(parsed.data);
      }
      break;
    }

    case "payout.created":
    case "payout.paid": {
      const parsed = RewardfulPayoutSchema.safeParse(event.object);
      if (parsed.success) {
        await mirrorPayout(parsed.data, logger);
      }
      break;
    }

    default:
      logger.info({ eventType: event.event.type }, "Unhandled Rewardful event type");
  }
}

/**
 * Register Rewardful webhook route (only when feature enabled and secret configured).
 */
export async function registerRewardfulWebhookIfConfigured(
  app: FastifyInstance
): Promise<void> {
  const secret = process.env.REWARDFUL_WEBHOOK_SECRET?.trim();
  const enabled = process.env.AFFILIATES_ENABLED === "true";

  if (!enabled || !secret) {
    return;
  }

  await app.register(
    async function rewardfulScope(f) {
      // Rate limit
      const { rateLimitMaxPublic, RATE_LIMIT_WINDOW_MS } = await import("../lib/rate-limit-env.js");
      const isTest = process.env.NODE_ENV === "test";
      await f.register(import("@fastify/rate-limit"), {
        max: rateLimitMaxPublic(isTest),
        timeWindow: RATE_LIMIT_WINDOW_MS,
      });

      f.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_req, body, done) => {
          done(null, body);
        }
      );

      f.post("/webhooks/rewardful", async (request, reply) => {
        const sig = request.headers["x-rewardful-signature"];
        if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) {
          return reply.status(400).send({ error: "Missing or invalid X-Rewardful-Signature" });
        }

        const buf = request.body as Buffer;
        
        // Verify signature
        if (!verifyRewardfulSignature(buf, sig, secret)) {
          return reply.status(401).send({ error: "Invalid signature" });
        }

        let event: RewardfulWebhookEvent;
        try {
          const parsed = JSON.parse(buf.toString("utf8"));
          const validated = RewardfulWebhookEventSchema.safeParse(parsed);
          if (!validated.success) {
            return reply.status(400).send({ error: "Invalid webhook payload" });
          }
          event = validated.data;
        } catch {
          return reply.status(400).send({ error: "Invalid JSON" });
        }

        // Deduplicate with claim
        const dedupeResult = await dedupeWebhookEvent(
          prisma,
          "rewardful",
          event.event.id,
          event.event.type
        );
        if (dedupeResult.kind === "duplicate") {
          return reply.send({ received: true });
        }
        if (dedupeResult.kind === "processing") {
          return reply.status(409).send({ error: "Event is being processed by another delivery" });
        }

        try {
          await processRewardfulEvent(event, request.log);
          await markWebhookProcessed(prisma, dedupeResult.id, dedupeResult.claimToken);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await markWebhookFailed(prisma, dedupeResult.id, dedupeResult.claimToken, errorMessage);
          throw err;
        }

        return reply.send({ received: true });
      });
    },
    { prefix: "/" }
  );
}
