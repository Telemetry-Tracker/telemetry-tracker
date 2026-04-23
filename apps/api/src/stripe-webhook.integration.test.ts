import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import type { FastifyInstance } from "fastify";
import { PlanTier } from "@prisma/client";
import { createApp } from "./app.js";
import { prisma } from "./lib/db.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)(
  "Stripe webhook checkout.session.completed conflict handling",
  () => {
    let app: FastifyInstance | undefined;
    let previousWebhookSecret: string | undefined;
    let previousStripeKey: string | undefined;
    let sourceOrgId: string | undefined;
    let targetOrgId: string | undefined;

    beforeAll(async () => {
      previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      previousStripeKey = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_vitest_secret";
      process.env.STRIPE_SECRET_KEY = "sk_test_vitest_secret";

      const suffix = randomBytes(6).toString("hex");
      const sharedCustomerId = `cus_${suffix}`;
      const sharedSubscriptionId = `sub_${suffix}`;

      const sourceOrg = await prisma.organization.create({
        data: {
          name: `Stripe source ${suffix}`,
          plan_tier: PlanTier.PRO,
          stripe_customer_id: sharedCustomerId,
          stripe_subscription_id: sharedSubscriptionId,
        },
      });
      sourceOrgId = sourceOrg.id;

      const targetOrg = await prisma.organization.create({
        data: {
          name: `Stripe target ${suffix}`,
          plan_tier: PlanTier.FREE,
        },
      });
      targetOrgId = targetOrg.id;

      app = await createApp();
    });

    afterAll(async () => {
      if (app) await app.close();
      if (targetOrgId) {
        await prisma.organization.delete({ where: { id: targetOrgId } }).catch(() => {});
      }
      if (sourceOrgId) {
        await prisma.organization.delete({ where: { id: sourceOrgId } }).catch(() => {});
      }
      if (previousWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
      if (previousStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousStripeKey;
    });

    it("does not grant paid tier when Stripe ids are already linked to another org", async () => {
      const source = await prisma.organization.findUnique({
        where: { id: sourceOrgId! },
        select: { stripe_customer_id: true, stripe_subscription_id: true },
      });
      expect(source?.stripe_customer_id).toBeTruthy();
      expect(source?.stripe_subscription_id).toBeTruthy();

      const eventPayload = JSON.stringify({
        id: `evt_${randomBytes(8).toString("hex")}`,
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_${randomBytes(8).toString("hex")}`,
            object: "checkout.session",
            metadata: {
              organization_id: targetOrgId,
              plan_tier: "PRO",
            },
            customer: source!.stripe_customer_id,
            subscription: source!.stripe_subscription_id,
          },
        },
      });
      const stripeSignature = Stripe.webhooks.generateTestHeaderString({
        payload: eventPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });

      const res = await app!.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripeSignature,
        },
        payload: eventPayload,
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ received: true });

      const targetAfter = await prisma.organization.findUnique({
        where: { id: targetOrgId! },
        select: {
          plan_tier: true,
          stripe_customer_id: true,
          stripe_subscription_id: true,
        },
      });
      expect(targetAfter).not.toBeNull();
      expect(targetAfter!.plan_tier).toBe(PlanTier.FREE);
      expect(targetAfter!.stripe_customer_id).toBeNull();
      expect(targetAfter!.stripe_subscription_id).toBeNull();
    });
  }
);
