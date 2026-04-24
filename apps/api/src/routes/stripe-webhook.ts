import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { PlanTier } from "@prisma/client";
import { prisma } from "../lib/db.js";

function parsePlanTier(raw: string | undefined): PlanTier | null {
  const u = raw?.trim().toUpperCase();
  if (u === "FREE" || u === "PRO" || u === "BUSINESS") return u;
  return null;
}

/** Prisma P2002 — unique constraint (e.g. Stripe customer/sub already bound to another org). */
function isUniqueConstraintError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "P2002"
  );
}

type CheckoutUpgradeInput = {
  orgId: string;
  tier: Exclude<PlanTier, PlanTier.FREE>;
  customerId: string | null;
  subscriptionId: string | null;
  eventId: string;
};

type OrganizationModel = {
  updateMany(args: {
    where: { id: string; deleted_at: null };
    data: {
      plan_tier: Exclude<PlanTier, PlanTier.FREE>;
      stripe_customer_id?: string;
      stripe_subscription_id: string;
    };
  }): Promise<unknown>;
};

type LoggerLike = {
  warn(bindings: Record<string, unknown>, message: string): void;
};

/**
 * Applies a checkout upgrade only when we can also bind the Stripe subscription id.
 * Failing closed avoids granting paid entitlements that cannot be revoked on
 * `customer.subscription.deleted`.
 */
export async function applyCheckoutUpgradeUpdate(
  organizationModel: OrganizationModel,
  logger: LoggerLike,
  input: CheckoutUpgradeInput
): Promise<void> {
  if (input.subscriptionId === null) {
    logger.warn(
      { orgId: input.orgId, eventId: input.eventId },
      "checkout.session.completed: missing subscription id; refusing to grant paid tier"
    );
    return;
  }

  const data: {
    plan_tier: Exclude<PlanTier, PlanTier.FREE>;
    stripe_customer_id?: string;
    stripe_subscription_id: string;
  } = {
    plan_tier: input.tier,
    stripe_subscription_id: input.subscriptionId,
  };
  if (input.customerId !== null) data.stripe_customer_id = input.customerId;

  try {
    await organizationModel.updateMany({
      where: { id: input.orgId, deleted_at: null },
      data,
    });
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
    logger.warn(
      { err: e, orgId: input.orgId, eventId: input.eventId },
      "checkout.session.completed: Stripe ids already linked elsewhere; refusing to grant paid tier without binding subscription id"
    );
  }
}

/**
 * Stripe webhook (`POST /webhooks/stripe`). Registers only when
 * `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set.
 * Uses a raw JSON body parser so signature verification works.
 *
 * Expected metadata on Checkout Session (etc.): `organization_id`, `plan_tier`.
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

        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const orgId = session.metadata?.organization_id?.trim();
            const tier = parsePlanTier(session.metadata?.plan_tier);
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
              await applyCheckoutUpgradeUpdate(prisma.organization, request.log, {
                orgId,
                tier,
                customerId,
                subscriptionId: subId,
                eventId: event.id,
              });
            }
            break;
          }
          case "customer.subscription.deleted": {
            const sub = event.data.object as Stripe.Subscription;
            await prisma.organization.updateMany({
              where: { stripe_subscription_id: sub.id },
              data: {
                plan_tier: PlanTier.FREE,
                stripe_subscription_id: null,
              },
            });
            break;
          }
          default:
            break;
        }

        return reply.send({ received: true });
      });
    },
    { prefix: "/" }
  );
}
