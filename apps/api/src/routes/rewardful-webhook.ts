/**
 * Rewardful webhook handler (`POST /webhooks/rewardful`).
 * Registered only when AFFILIATES_ENABLED=true and REWARDFUL_WEBHOOK_SECRET is set.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { verifyRewardfulSignature } from "../lib/rewardful-webhook-signature.js";
import {
  dedupeWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
} from "../lib/webhook-dedupe.js";
import { normalizeEmailForSelfReferralCheck } from "../lib/affiliate-email-normalize.js";

type RewardfulWebhookEvent = {
  id: string;
  type: string;
  data: {
    affiliate?: {
      id: string;
      token?: string;
      email?: string;
      state?: string;
    };
    referral?: {
      id: string;
      affiliate_id?: string;
      stripe_customer_id?: string;
      state?: string;
    };
    commission?: {
      id: string;
      affiliate_id?: string;
      stripe_charge_id?: string;
      amount_cents?: number;
      currency?: string;
      state?: string;
      due_at?: string;
      paid_at?: string;
      voided_at?: string;
    };
  };
};

/**
 * Upsert Affiliate mirror from Rewardful webhook.
 */
async function upsertAffiliate(affiliateData: NonNullable<RewardfulWebhookEvent["data"]["affiliate"]>) {
  const emailNormalized = affiliateData.email
    ? normalizeEmailForSelfReferralCheck(affiliateData.email)
    : "";

  await prisma.affiliate.upsert({
    where: { rewardful_affiliate_id: affiliateData.id },
    create: {
      rewardful_affiliate_id: affiliateData.id,
      link_token: affiliateData.token ?? null,
      email_normalized: emailNormalized,
      state: affiliateData.state ?? "active",
    },
    update: {
      link_token: affiliateData.token ?? undefined,
      email_normalized: emailNormalized || undefined,
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
  // Complete UserReferrals
  const updatedUsers = await prisma.userReferral.updateMany({
    where: {
      rewardful_referral_id: rewardfulReferralId,
      affiliate_id: null,
    },
    data: { affiliate_id: affiliateId },
  });

  // Complete OrganizationReferrals and clear needs_attention
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
async function upsertCommission(commissionData: NonNullable<RewardfulWebhookEvent["data"]["commission"]>) {
  // Find affiliate by Rewardful ID
  const affiliate = commissionData.affiliate_id
    ? await prisma.affiliate.findFirst({
        where: { rewardful_affiliate_id: commissionData.affiliate_id },
        select: { id: true },
      })
    : null;

  // Find organization by Stripe charge ID
  // Note: We don't store charge IDs directly, but Customer ID should be in metadata
  // For V1, leave organization_id null; manual reconciliation if needed
  const organizationId: string | null = null;

  await prisma.affiliateCommission.upsert({
    where: { rewardful_commission_id: commissionData.id },
    create: {
      rewardful_commission_id: commissionData.id,
      affiliate_id: affiliate?.id ?? null,
      organization_id: organizationId,
      stripe_charge_id: commissionData.stripe_charge_id ?? null,
      amount_cents: commissionData.amount_cents ?? 0,
      currency: commissionData.currency ?? "EUR",
      state: commissionData.state ?? "pending",
      due_at: commissionData.due_at ? new Date(commissionData.due_at) : null,
      paid_at: commissionData.paid_at ? new Date(commissionData.paid_at) : null,
      voided_at: commissionData.voided_at ? new Date(commissionData.voided_at) : null,
    },
    update: {
      affiliate_id: affiliate?.id ?? undefined,
      organization_id: organizationId ?? undefined,
      state: commissionData.state ?? undefined,
      due_at: commissionData.due_at ? new Date(commissionData.due_at) : undefined,
      paid_at: commissionData.paid_at ? new Date(commissionData.paid_at) : undefined,
      voided_at: commissionData.voided_at ? new Date(commissionData.voided_at) : undefined,
    },
  });
}

/**
 * Process Rewardful webhook event.
 */
async function processRewardfulEvent(
  event: RewardfulWebhookEvent,
  logger: { info: (msg: unknown, context: string) => void; warn: (msg: unknown, context: string) => void }
): Promise<void> {
  switch (event.type) {
    case "affiliate.created":
    case "affiliate.updated":
      if (event.data.affiliate) {
        await upsertAffiliate(event.data.affiliate);
      }
      break;

    case "referral.created":
    case "referral.converted":
      if (event.data.referral) {
        const referralData = event.data.referral;
        
        // Complete unresolved referrals
        if (referralData.affiliate_id && referralData.id) {
          const affiliate = await prisma.affiliate.findFirst({
            where: { rewardful_affiliate_id: referralData.affiliate_id },
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
      }
      break;

    case "commission.created":
    case "commission.updated":
    case "commission.paid":
    case "commission.voided":
      if (event.data.commission) {
        await upsertCommission(event.data.commission);
      }
      break;

    default:
      logger.info({ eventType: event.type }, "Unhandled Rewardful event type");
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
      f.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_req, body, done) => {
          done(null, body);
        }
      );

      f.post("/webhooks/rewardful", async (request, reply) => {
        const sig = request.headers["x-rewardful-signature"];
        if (typeof sig !== "string") {
          return reply.status(400).send({ error: "Missing X-Rewardful-Signature" });
        }

        const buf = request.body as Buffer;
        
        // Verify signature
        if (!verifyRewardfulSignature(buf, sig, secret)) {
          return reply.status(401).send({ error: "Invalid signature" });
        }

        let event: RewardfulWebhookEvent;
        try {
          event = JSON.parse(buf.toString("utf8"));
        } catch {
          return reply.status(400).send({ error: "Invalid JSON" });
        }

        // Deduplicate with claim
        const dedupeResult = await dedupeWebhookEvent(
          prisma,
          "rewardful",
          event.id,
          event.type
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
