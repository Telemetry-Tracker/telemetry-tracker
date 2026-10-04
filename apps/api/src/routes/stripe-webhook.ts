import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { PlanTier } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  parsePlanTierMetadata,
  subscriptionToOrgSyncPatch,
} from "../lib/stripe-subscription-sync.js";
import { stripeSubscriptionPeriodEndUnix } from "../lib/stripe-runtime-fields.js";
import {
  dedupeWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
} from "../lib/webhook-dedupe.js";

/** Prisma P2002 — unique constraint (e.g. Stripe customer/sub already bound to another org). */
function isUniqueConstraintError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "P2002"
  );
}

/**
 * Stripe webhook (`POST /webhooks/stripe`). Registers only when
 * `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set.
 * Uses a raw JSON body parser so signature verification works.
 *
 * Expected metadata on Checkout Session (etc.): `organization_id`, `plan_tier`.
 * For `customer.subscription.updated`, also set `plan_tier` on the **Subscription** or **Price** metadata
 * so plan changes sync (see docs/ENTITLEMENTS.md).
 */
export async function registerStripeWebhookIfConfigured(
  app: FastifyInstance
): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret || !key) return;

  const stripe = new Stripe(key);

  await app.register(
    async function stripeScope(f) {
      f.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_req, body, done) => {
          done(null, body);
        }
      );

      f.post("/webhooks/stripe", async (request, reply) => {
        const sig = request.headers["stripe-signature"];
        if (typeof sig !== "string") {
          return reply.status(400).send({ error: "Missing stripe-signature" });
        }
        const buf = request.body as Buffer;
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(buf, sig, secret);
        } catch {
          return reply.status(400).send({ error: "Invalid signature" });
        }

        // Deduplicate webhook events (idempotency)
        const dedupeResult = await dedupeWebhookEvent(
          prisma,
          "stripe",
          event.id,
          event.type
        );
        if (dedupeResult.kind === "duplicate") {
          // Already processed; return success to prevent Stripe retries
          return reply.send({ received: true });
        }

        try {
          await processStripeEvent(event, request, stripe);
          await markWebhookProcessed(prisma, dedupeResult.id);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await markWebhookFailed(prisma, dedupeResult.id, errorMessage);
          throw err; // Re-throw to let Fastify handle error response
        }

        return reply.send({ received: true });
      });
    },
    { prefix: "/" }
  );
}

/**
 * Process Stripe webhook event (extracted for testability and to preserve existing behavior).
 */
async function processStripeEvent(
  event: Stripe.Event,
  request: { log: { warn: (arg: unknown, msg: string) => void } },
  stripe: Stripe
): Promise<void> {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const orgId = session.metadata?.organization_id?.trim();
            const tier = parsePlanTierMetadata(session.metadata?.plan_tier);
            if (orgId && tier && tier !== PlanTier.FREE) {
              const customerId =
                typeof session.customer === "string"
                  ? session.customer
                  : session.customer?.id ?? null;
              const subId =
                typeof session.subscription === "string"
                  ? session.subscription
                  : session.subscription &&
                      typeof session.subscription === "object" &&
                      "id" in session.subscription
                    ? (session.subscription as Stripe.Subscription).id
                    : null;
              const data: Prisma.OrganizationUpdateManyMutationInput = {
                plan_tier: tier,
              };
              if (customerId !== null) data.stripe_customer_id = customerId;
              if (subId !== null) data.stripe_subscription_id = subId;
              if (subId !== null) {
                try {
                  const fullSub = await stripe.subscriptions.retrieve(subId);
                  data.stripe_subscription_status = fullSub.status;
                  const pe = stripeSubscriptionPeriodEndUnix(fullSub);
                  data.stripe_current_period_end = pe
                    ? new Date(pe * 1000)
                    : null;
                } catch (err) {
                  request.log.warn(
                    { err, subId, eventId: event.id },
                    "checkout.session.completed: could not retrieve subscription for status fields"
                  );
                }
              }
              try {
                await prisma.organization.updateMany({
                  where: { id: orgId, deleted_at: null },
                  data,
                });
              } catch (e) {
                if (!isUniqueConstraintError(e)) throw e;
                request.log.warn(
                  { err: e, orgId, eventId: event.id },
                  "checkout.session.completed: Stripe customer/subscription ids already linked elsewhere; applying plan tier only"
                );
                await prisma.organization.updateMany({
                  where: { id: orgId, deleted_at: null },
                  data: { plan_tier: tier },
                });
              }
            }
            break;
          }
          case "customer.subscription.updated": {
            const sub = event.data.object as Stripe.Subscription;
            const patch = subscriptionToOrgSyncPatch(sub);
            await prisma.organization.updateMany({
              where: { stripe_subscription_id: sub.id, deleted_at: null },
              data: patch,
            });
            const { loadPlanContextForOrganization } = await import(
              "../lib/plan-enforcement.js"
            );
            const { billingHealthFromPlanContext } = await import(
              "../lib/billing-alert.js"
            );
            const { notifyBillingAlertEmail } = await import(
              "../lib/notification-email-dispatch.js"
            );
            const orgs = await prisma.organization.findMany({
              where: { stripe_subscription_id: sub.id, deleted_at: null },
              select: { id: true },
            });
            for (const org of orgs) {
              const ctx = await loadPlanContextForOrganization(prisma, org.id);
              if (!ctx) continue;
              const health = billingHealthFromPlanContext(ctx);
              if (health.billingAlertVariant) {
                void notifyBillingAlertEmail(
                  prisma,
                  org.id,
                  health.billingAlertVariant,
                  health.storedPlanTier,
                  health.effectivePlanTier,
                  ctx.stripeCurrentPeriodEnd
                );
              }
            }
            break;
          }
          case "customer.subscription.deleted": {
            const sub = event.data.object as Stripe.Subscription;
            const orgsBefore = await prisma.organization.findMany({
              where: { stripe_subscription_id: sub.id, deleted_at: null },
              select: { id: true },
            });
            await prisma.organization.updateMany({
              where: { stripe_subscription_id: sub.id },
              data: {
                plan_tier: PlanTier.FREE,
                stripe_subscription_id: null,
                stripe_subscription_status: null,
                stripe_current_period_end: null,
              },
            });
            const { notifyBillingAlertEmail } = await import(
              "../lib/notification-email-dispatch.js"
            );
            for (const org of orgsBefore) {
              const periodEndUnix = stripeSubscriptionPeriodEndUnix(sub);
              const periodEnd = periodEndUnix
                ? new Date(periodEndUnix * 1000)
                : null;
              void notifyBillingAlertEmail(
                prisma,
                org.id,
                "canceled",
                PlanTier.FREE,
                PlanTier.FREE,
                periodEnd
              );
            }
            break;
          }
          default:
            break;
        }
}
