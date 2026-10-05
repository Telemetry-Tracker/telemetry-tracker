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
const RewardfulAffiliateSchema = z.object({
  id: z.string(),
  state: z.enum(["active", "suspended"]).optional(),
  email: z.string().optional(),
  links: z.array(z.object({ token: z.string().optional() })).optional(),
});

const RewardfulReferralSchema = z.object({
  id: z.string(),
  affiliate: z.object({ id: z.string() }).optional(),
  stripe_customer_id: z.string().optional(),
  state: z.string().optional(),
});

const RewardfulCommissionSchema = z.object({
  id: z.string(),
  affiliate: z.object({ id: z.string() }).optional(),
  amount: z.number().optional(), // cents
  currency: z.string().optional(),
  state: z.string().optional(),
  due_at: z.string().optional(),
  paid_at: z.string().optional(),
  voided_at: z.string().optional(),
  sale: z.object({ stripe_charge_id: z.string().optional() }).optional(),
});

const RewardfulPayoutSchema = z.object({
  id: z.string(),
  affiliate: z.object({ id: z.string() }).optional(),
  amount: z.number().optional(), // cents
  currency: z.string().optional(),
  state: z.string().optional(),
  paid_at: z.string().optional(),
});

const RewardfulWebhookEventSchema = z.object({
  event: z.object({
    id: z.string(),
    type: z.string(),
  }),
  object: z.union([
    RewardfulAffiliateSchema,
    RewardfulReferralSchema,
    RewardfulCommissionSchema,
    RewardfulPayoutSchema,
  ]),
});

type RewardfulWebhookEvent = z.infer<typeof RewardfulWebhookEventSchema>;

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
 */
async function completeUnresolvedReferrals(
  affiliateId: string,
  rewardfulReferralId: string,
  logger?: { info: (msg: unknown, context: string) => void }
) {
  // Complete UserReferrals - only update if affiliate_id is NULL
  const updatedUsers = await prisma.userReferral.updateMany({
    where: {
      rewardful_referral_id: rewardfulReferralId,
      affiliate_id: null,
    },
    data: { affiliate_id: affiliateId },
  });

  // Complete OrganizationReferrals and clear needs_attention - only update if affiliate_id is NULL
  const updatedOrgs = await prisma.organizationReferral.updateMany({
    where: {
      rewardful_referral_id: rewardfulReferralId,
      affiliate_id: null,
    },
    data: {
      affiliate_id: affiliateId,
      needs_attention: false,
      attention_reason: null,
    },
  });

  if ((updatedUsers.count > 0 || updatedOrgs.count > 0) && logger) {
    logger.info(
      { affiliateId, rewardfulReferralId, userCount: updatedUsers.count, orgCount: updatedOrgs.count },
      "Completed unresolved referrals via Rewardful webhook"
    );
  }
}

/**
 * Link referral to organization via Stripe customer ID.
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
    // Update rewardful_referral_id if missing
    if (!existing.rewardful_referral_id && rewardfulReferralId) {
      await prisma.organizationReferral.update({
        where: { organization_id: org.id },
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
  // Find affiliate by Rewardful ID
  const affiliate = commissionData.affiliate?.id
    ? await prisma.affiliate.findFirst({
        where: { rewardful_affiliate_id: commissionData.affiliate.id },
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
      currency: commissionData.currency ?? "EUR",
      state: commissionData.state ?? "pending",
      due_at: commissionData.due_at ? new Date(commissionData.due_at) : null,
      paid_at: commissionData.paid_at ? new Date(commissionData.paid_at) : null,
      voided_at: commissionData.voided_at ? new Date(commissionData.voided_at) : null,
    },
    update: {
      affiliate_id: affiliate?.id ?? undefined,
      state: commissionData.state ?? undefined,
      due_at: commissionData.due_at ? new Date(commissionData.due_at) : undefined,
      paid_at: commissionData.paid_at ? new Date(commissionData.paid_at) : undefined,
      voided_at: commissionData.voided_at ? new Date(commissionData.voided_at) : undefined,
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

    case "referral.created":
    case "referral.converted": {
      const parsed = RewardfulReferralSchema.safeParse(event.object);
      if (!parsed.success) break;
      
      const referralData = parsed.data;
      
      // Complete unresolved referrals
      if (referralData.affiliate?.id && referralData.id) {
        const affiliate = await prisma.affiliate.findFirst({
          where: { rewardful_affiliate_id: referralData.affiliate.id },
          select: { id: true },
        });
        if (affiliate) {
          await completeUnresolvedReferrals(affiliate.id, referralData.id, logger);
        }
      }

      // Link to organization if Stripe customer is known
      if (referralData.stripe_customer_id && referralData.id) {
        await linkReferralToOrganization(referralData.stripe_customer_id, referralData.id, logger);
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
          await markWebhookProcessed(prisma, dedupeResult.id);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await markWebhookFailed(prisma, dedupeResult.id, errorMessage);
          throw err;
        }

        return reply.send({ received: true });
      });
    },
    { prefix: "/" }
  );
}
