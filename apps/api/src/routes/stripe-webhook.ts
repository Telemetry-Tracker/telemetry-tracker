import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { PlanTier } from "@prisma/client";
import { prisma } from "../lib/db.js";

function parsePlanTier(raw: string | undefined): PlanTier | null {
  const u = raw?.trim().toUpperCase();
  if (u === "FREE" || u === "PRO" || u === "BUSINESS") return u;
  return null;
}

type StripeUniqueTarget = "stripe_customer_id" | "stripe_subscription_id";
type PaidTierUpdateData = {
  plan_tier: Exclude<PlanTier, PlanTier.FREE>;
  stripe_subscription_id: string;
  stripe_customer_id?: string;
};

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
 * Extract constrained field names from a Prisma unique error.
 * If the shape is unexpected, returns an empty set.
 */
export function uniqueConstraintTargets(e: unknown): Set<StripeUniqueTarget> {
  if (!isUniqueConstraintError(e)) return new Set();
  const maybeMeta =
    typeof e === "object" && e !== null && "meta" in e
      ? (e as { meta?: { target?: unknown } }).meta
      : undefined;
  const raw = maybeMeta?.target;
  const names = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  const out = new Set<StripeUniqueTarget>();
  for (const n of names) {
    if (n === "stripe_customer_id" || n === "stripe_subscription_id") out.add(n);
  }
  return out;
}

function buildPaidTierUpdateData(
  tier: Exclude<PlanTier, PlanTier.FREE>,
  customerId: string | null,
  subId: string | null
): PaidTierUpdateData | null {
  if (subId === null) return null;
  const data: PaidTierUpdateData = { plan_tier: tier, stripe_subscription_id: subId };
  if (customerId !== null) data.stripe_customer_id = customerId;
  return data;
}

/**
 * Retry only when customer id conflicts but subscription id can still be bound.
 * Applying a paid tier without a unique subscription link can leave orgs permanently over-entitled.
 */
export function selectPaidTierFallbackData(
  tier: Exclude<PlanTier, PlanTier.FREE>,
  subId: string | null,
  conflictTargets: Set<StripeUniqueTarget>
): Pick<PaidTierUpdateData, "plan_tier" | "stripe_subscription_id"> | null {
  if (subId === null) return null;
  const customerOnlyConflict =
    conflictTargets.size > 0 &&
    conflictTargets.has("stripe_customer_id") &&
    !conflictTargets.has("stripe_subscription_id");
  if (!customerOnlyConflict) return null;
  return { plan_tier: tier, stripe_subscription_id: subId };
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
              const data = buildPaidTierUpdateData(tier, customerId, subId);
              if (data === null) {
                request.log.warn(
                  { orgId, eventId: event.id },
                  "checkout.session.completed: non-free tier without subscription id; skipping update"
                );
                break;
              }
              try {
                await prisma.organization.updateMany({
                  where: { id: orgId, deleted_at: null },
                  data,
                });
              } catch (e) {
                if (!isUniqueConstraintError(e)) throw e;
                const targets = uniqueConstraintTargets(e);
                const fallback = selectPaidTierFallbackData(tier, subId, targets);
                if (!fallback) {
                  request.log.error(
                    {
                      err: e,
                      orgId,
                      eventId: event.id,
                      conflictTargets: [...targets],
                    },
                    "checkout.session.completed: paid tier not applied because subscription ownership is ambiguous"
                  );
                  break;
                }
                request.log.warn(
                  { err: e, orgId, eventId: event.id },
                  "checkout.session.completed: customer id already linked elsewhere; retrying with subscription id only"
                );
                await prisma.organization.updateMany({
                  where: { id: orgId, deleted_at: null },
                  data: fallback,
                });
              }
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
