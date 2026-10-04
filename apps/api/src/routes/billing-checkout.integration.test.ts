/**
 * Checkout-to-webhook integration test
 * Verifies the full flow: checkout session creation -> webhook delivery -> org upgrade
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import Stripe from "stripe";
import crypto from "node:crypto";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

testSuite("Billing Checkout Integration", () => {
  let app: FastifyInstance;
  let testUserIds: string[] = [];
  let testOrgIds: string[] = [];
  const stripeKey = "sk_test_mock";
  const webhookSecret = "whsec_test";

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = stripeKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_PRICE_PRO = "price_test_pro";
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_PRO;
  });

  beforeEach(async () => {
    if (testOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: testOrgIds } },
      });
      testOrgIds = [];
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      });
      testUserIds = [];
    }
  });

  describe("Flag OFF", () => {
    beforeAll(() => {
      delete process.env.AFFILIATES_ENABLED;
    });

    it("checkout args deep-equal develop's (no allow_promotion_codes, organization_id only)", async () => {
      // Register user
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `checkout-off${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `tt-session=${sessionId}` },
        payload: { name: "Test Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Mock Stripe
      const stripeMock = {
        customers: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (params: any) => ({ id: `cus_${Date.now()}`, ...params }),
        },
        checkout: {
          sessions: {
            create: async (params: Stripe.Checkout.SessionCreateParams) => {
              // Verify flag-OFF args
              expect(params.allow_promotion_codes).toBeUndefined();
              expect(params.metadata?.organization_id).toBe(orgId);
              expect(params.metadata?.plan_tier).toBe("PRO");
              expect(params.metadata?.tt_org_id).toBeUndefined();
              expect(params.metadata?.tt_affiliate_id).toBeUndefined();
              expect(params.subscription_data?.metadata?.organization_id).toBe(orgId);

              return {
                id: `cs_${Date.now()}`,
                url: "https://checkout.stripe.com/test",
                ...params,
              } as Stripe.Checkout.Session;
            },
          },
        },
      };

      // Inject Stripe mock
      const Stripe = (await import("stripe")).default;
      const originalStripe = Stripe.prototype.checkout;
      Object.assign(Stripe.prototype, { checkout: stripeMock.checkout });
      Object.assign(Stripe.prototype, { customers: stripeMock.customers });

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `tt-session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);

      // Restore
      Stripe.prototype.checkout = originalStripe;
    });

    it("webhook upgrades org with organization_id", async () => {
      // Create org
      const org = await prisma.organization.create({
        data: {
          name: "Webhook Test Org",
          memberships: {
            create: {
              user: {
                create: {
                  email: `webhook${Date.now()}@example.com`,
                  password_hash: "hash",
                },
              },
              role: "OWNER",
            },
          },
        },
      });
      testOrgIds.push(org.id);
      testUserIds.push((await prisma.organizationMembership.findFirst({
        where: { organization_id: org.id },
        select: { user_id: true },
      }))!.user_id);

      // Build webhook event
      const event = {
        id: `evt_test_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test",
            customer: "cus_test",
            subscription: "sub_test",
            metadata: {
              organization_id: org.id,
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      const finalSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");

      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/stripe",
        headers: {
          "stripe-signature": `t=${timestamp},v1=${finalSig}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify org upgraded
      const upgraded = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
      expect(upgraded?.stripe_customer_id).toBe("cus_test");
      expect(upgraded?.stripe_subscription_id).toBe("sub_test");
    });
  });

  describe("Flag ON", () => {
    beforeAll(() => {
      process.env.AFFILIATES_ENABLED = "true";
    });

    afterAll(() => {
      delete process.env.AFFILIATES_ENABLED;
    });

    it("checkout includes affiliate metadata for referred orgs", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: "aff_checkout_test",
          link_token: "checkouttoken",
          email_normalized: "aff@example.com",
          state: "active",
        },
      });

      // Register referred user
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `checkout-on${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: "checkouttoken",
        },
      });
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `tt-session=${sessionId}` },
        payload: { name: "Referred Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Mock Stripe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedMetadata: any;
      const stripeMock = {
        customers: {
          retrieve: async () => ({ id: "cus_existing", deleted: false, metadata: {} }),
        },
        checkout: {
          sessions: {
            create: async (params: Stripe.Checkout.SessionCreateParams) => {
              capturedMetadata = params.metadata;
              // Verify flag-ON args
              expect(params.allow_promotion_codes).toBe(true);
              expect(params.metadata?.organization_id).toBe(orgId);
              expect(params.metadata?.tt_org_id).toBe(orgId);
              expect(params.metadata?.tt_affiliate_id).toBe(affiliate.id);

              return {
                id: `cs_${Date.now()}`,
                url: "https://checkout.stripe.com/test",
              } as Stripe.Checkout.Session;
            },
          },
        },
      };

      const Stripe = (await import("stripe")).default;
      Object.assign(Stripe.prototype, { checkout: stripeMock.checkout, customers: stripeMock.customers });

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `tt-session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedMetadata?.tt_affiliate_id).toBe(affiliate.id);

      // Cleanup
      await prisma.affiliate.delete({ where: { id: affiliate.id } });
    });
  });
});
