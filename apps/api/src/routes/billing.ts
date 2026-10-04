import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import Stripe from "stripe";
import { PlanTier, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireSessionUser } from "../lib/auth-session.js";
import {
  canManageMembers,
  getMembershipRoleForOrganization,
} from "../lib/org-permissions.js";
import { dashboardOriginOrNull } from "../lib/dashboard-origin.js";
import { stripePriceIdForTier } from "../lib/stripe-price-config.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

function parseUpgradeTier(raw: unknown): "PRO" | "BUSINESS" | null {
  if (raw === "PRO" || raw === PlanTier.PRO) return "PRO";
  if (raw === "BUSINESS" || raw === PlanTier.BUSINESS) return "BUSINESS";
  return null;
}

/** Resolve Stripe customer id without holding a row lock across Stripe API calls. */
async function resolveStripeCustomerId(
  stripe: Stripe,
  orgId: string
): Promise<string | null> {
  const unlocked = await prisma.organization.findFirst({
    where: { id: orgId, deleted_at: null },
    select: { stripe_customer_id: true, name: true },
  });
  if (!unlocked) return null;
  if (unlocked.stripe_customer_id) return unlocked.stripe_customer_id;

  const pendingCreate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
    );
    const org = await tx.organization.findFirst({
      where: { id: orgId, deleted_at: null },
      select: { stripe_customer_id: true, name: true },
    });
    if (!org) return null;
    if (org.stripe_customer_id) {
      return { kind: "existing" as const, customerId: org.stripe_customer_id };
    }
    return { kind: "create" as const, orgName: org.name };
  });
  if (!pendingCreate) return null;
  if (pendingCreate.kind === "existing") return pendingCreate.customerId;

      const customer = await stripe.customers.create({
    name: pendingCreate.orgName,
    metadata: { organization_id: orgId },
  });

  const savedId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
    );
    const org = await tx.organization.findFirst({
      where: { id: orgId, deleted_at: null },
      select: { stripe_customer_id: true },
    });
    if (!org) return null;
    if (org.stripe_customer_id) return org.stripe_customer_id;
    await tx.organization.update({
      where: { id: orgId },
      data: { stripe_customer_id: customer.id },
    });
    return customer.id;
  });
  return savedId;
}

/**
 * Stripe Checkout + Billing Portal for organization owners.
 * Requires STRIPE_SECRET_KEY and price ids STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS.
 */
export async function billingRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  app.post<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId/billing/checkout",
    async (request, reply) => {
      const stripe = stripeClient();
      if (!stripe) {
        return reply.status(503).send({ error: "Stripe is not configured" });
      }
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const role = await getMembershipRoleForOrganization(session.userId, orgId);
      if (!canManageMembers(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const body = (request.body ?? {}) as { planTier?: string };
      const tier = parseUpgradeTier(body.planTier);
      if (!tier) {
        return reply.status(400).send({ error: "planTier must be PRO or BUSINESS" });
      }
      const priceId = stripePriceIdForTier(tier);
      if (!priceId) {
        return reply.status(503).send({ error: "Stripe price not configured for this tier" });
      }

      const customerId = await resolveStripeCustomerId(stripe, orgId);
      if (!customerId) {
        return reply.status(404).send({ error: "Organization not found" });
      }

      const origin = dashboardOriginOrNull();
      if (!origin) {
        return reply.status(503).send({ error: "Dashboard origin is not configured" });
      }

      // Update Customer metadata if org is referred but Customer lacks affiliate metadata
      const { isAffiliateFeatureEnabled } = await import("../lib/affiliates-feature-flag.js");
      if (isAffiliateFeatureEnabled()) {
        try {
          const referral = await prisma.organizationReferral.findUnique({
            where: { organization_id: orgId },
            select: {
              rewardful_referral_id: true,
              affiliate_id: true,
              via_token: true,
              needs_attention: true,
              attention_reason: true,
            },
          });
          // Only update if referral is valid (not expired or rejected)
          const isExpiredOrRejected = referral?.needs_attention &&
            (referral.attention_reason?.includes('expired') || referral.attention_reason?.includes('rejected'));
          
          if (referral && referral.affiliate_id && !isExpiredOrRejected) {
            const hasReferralSource = referral.rewardful_referral_id || referral.via_token;
            if (hasReferralSource) {
              // Check if Customer already has affiliate metadata
              const customer = await stripe.customers.retrieve(customerId);
              if (!customer.deleted && !customer.metadata?.tt_affiliate_id) {
                // Prefer Rewardful UUID, fall back to via token
                const referralValue = referral.rewardful_referral_id || referral.via_token;
                // Update Customer metadata (preserve organization_id if it exists)
                await stripe.customers.update(customerId, {
                  metadata: {
                    ...customer.metadata,
                    referral: referralValue,
                    tt_org_id: orgId,
                    tt_affiliate_id: referral.affiliate_id,
                  },
                });
                request.log.info(
                  { customerId, orgId },
                  "Updated Customer metadata with referral info at checkout"
                );
              }
            }
          }
        } catch (err) {
          // Log error but don't fail checkout
          request.log.error(
            { err, orgId },
            "Failed to update Customer metadata at checkout"
          );
        }
      }

      // Build metadata (always include organization_id for backward compatibility)
      const metadata: Record<string, string> = {
        organization_id: orgId,
        plan_tier: tier,
      };

      // Add affiliate metadata only when feature is enabled
      if (isAffiliateFeatureEnabled()) {
        try {
          const referral = await prisma.organizationReferral.findUnique({
            where: { organization_id: orgId },
            select: {
              rewardful_referral_id: true,
              affiliate_id: true,
            },
          });
          if (referral?.affiliate_id) {
            metadata.tt_org_id = orgId;
            metadata.tt_affiliate_id = referral.affiliate_id;
          }
        } catch (err) {
          request.log.warn({ err, orgId }, "Failed to fetch referral at checkout metadata build");
        }
      }

      // Enable promotion codes only when affiliate feature is ON
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/dashboard/settings/organization?billing=success`,
        cancel_url: `${origin}/dashboard/settings/organization?billing=canceled`,
        ...(isAffiliateFeatureEnabled() ? { allow_promotion_codes: true } : {}),
        metadata,
        subscription_data: {
          metadata,
        },
      };

      const checkout = await stripe.checkout.sessions.create(sessionParams);

      if (!checkout.url) {
        return reply.status(500).send({ error: "Could not create checkout session" });
      }
      return reply.send({ url: checkout.url });
    }
  );

  app.post<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId/billing/portal",
    async (request, reply) => {
      const stripe = stripeClient();
      if (!stripe) {
        return reply.status(503).send({ error: "Stripe is not configured" });
      }
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const role = await getMembershipRoleForOrganization(session.userId, orgId);
      if (!canManageMembers(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const org = await prisma.organization.findFirst({
        where: { id: orgId, deleted_at: null },
        select: { stripe_customer_id: true },
      });
      if (!org?.stripe_customer_id) {
        return reply.status(400).send({ error: "No Stripe customer for this organization" });
      }

      const origin = dashboardOriginOrNull();
      if (!origin) {
        return reply.status(503).send({ error: "Dashboard origin is not configured" });
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: `${origin}/dashboard/settings/organization`,
      });
      return reply.send({ url: portal.url });
    }
  );
}
