/**
 * Billing checkout-to-webhook integration test
 * Verifies the full flow: checkout metadata -> webhook delivery -> org upgrade
 * Tests metadata.organization_id regression and affiliate feature flag behavior
 *
 * Note: Focuses on webhook processing to test the billing regression.
 * Checkout route testing would require complex Stripe SDK mocking.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import crypto from "node:crypto";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

testSuite("Billing Checkout Integration", () => {
  let app: FastifyInstance;
  let testUserIds: string[] = [];
  let testOrgIds: string[] = [];
  let testAffiliateIds: string[] = [];
  const webhookSecret = "whsec_test_billing";

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.TELEMETRY_DASHBOARD_ORIGIN = "https://test.example.com";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    delete process.env.TELEMETRY_ALLOW_REGISTRATION;
  });

  beforeEach(async () => {
    if (testOrgIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { event_type: "checkout.session.completed" },
      }).catch(() => undefined);
      await prisma.organizationReferral.deleteMany({
        where: { organization_id: { in: testOrgIds } },
      });
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
    if (testAffiliateIds.length > 0) {
      await prisma.affiliate.deleteMany({
        where: { id: { in: testAffiliateIds } },
      });
      testAffiliateIds = [];
    }
  });

  describe("Flag OFF - Webhook Processing", () => {
    beforeAll(() => {
      delete process.env.AFFILIATES_ENABLED;
    });

    it("webhook upgrades org with metadata.organization_id", async () => {
      // Create user and org
      const user = await prisma.user.create({
        data: {
          email: `webhook-off${Date.now()}@example.com`,
          password_hash: "hash",
        },
      });
      testUserIds.push(user.id);

      const org = await prisma.organization.create({
        data: {
          name: "Webhook Test Org OFF",
          plan_tier: "FREE",
          memberships: {
            create: {
              user_id: user.id,
              role: "OWNER",
            },
          },
        },
      });
      testOrgIds.push(org.id);

      // Verify org starts as FREE
      expect(org.plan_tier).toBe("FREE");

      // Build webhook event with organization_id metadata
      const event = {
        id: `evt_test_off_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_off",
            customer: "cus_test_off",
            subscription: "sub_test_off",
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
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");

      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify org upgraded with correct fields
      const upgraded = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
      expect(upgraded?.stripe_customer_id).toBe("cus_test_off");
      expect(upgraded?.stripe_subscription_id).toBe("sub_test_off");
    });

    it("webhook processes event from checkout with organization_id metadata", async () => {
      // Simulate a checkout session that was created with organization_id in metadata
      const user = await prisma.user.create({
        data: {
          email: `checkout-flow-off${Date.now()}@example.com`,
          password_hash: "hash",
        },
      });
      testUserIds.push(user.id);

      const org = await prisma.organization.create({
        data: {
          name: "Checkout Flow Test",
          plan_tier: "FREE",
          memberships: {
            create: {
              user_id: user.id,
              role: "OWNER",
            },
          },
        },
      });
      testOrgIds.push(org.id);

      // Simulate webhook event from a checkout.session.completed
      // This mimics what Stripe would send after checkout with organization_id metadata
      const event = {
        id: `evt_checkout_flow_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_${Date.now()}`,
            customer: `cus_${Date.now()}`,
            subscription: `sub_${Date.now()}`,
            metadata: {
              organization_id: org.id,  // This is the critical regression test field
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");

      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify org upgraded
      const upgraded = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
      expect(upgraded?.stripe_customer_id).toBeTruthy();
      expect(upgraded?.stripe_subscription_id).toBeTruthy();
    });
  });

  describe("Flag ON - Webhook Processing", () => {
    beforeAll(() => {
      process.env.AFFILIATES_ENABLED = "true";
    });

    afterAll(() => {
      delete process.env.AFFILIATES_ENABLED;
    });

    it("webhook upgrades referred org with organization_id metadata", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: "aff_webhook_on",
          link_token: "webhooktoken",
          email_normalized: "aff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Create user and referred org
      const user = await prisma.user.create({
        data: {
          email: `webhook-on${Date.now()}@example.com`,
          password_hash: "hash",
        },
      });
      testUserIds.push(user.id);

      const org = await prisma.organization.create({
        data: {
          name: "Referred Org Webhook ON",
          plan_tier: "FREE",
          memberships: {
            create: {
              user_id: user.id,
              role: "OWNER",
            },
          },
          organization_referral: {
            create: {
              affiliate_id: affiliate.id,
              via_token: "webhooktoken",
              rewardful_referral_id: null,
              source: "via_token",
            },
          },
        },
      });
      testOrgIds.push(org.id);

      // Build webhook event with organization_id (backward compatible)
      const event = {
        id: `evt_test_on_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_on",
            customer: "cus_test_on",
            subscription: "sub_test_on",
            metadata: {
              organization_id: org.id,  // Still present for backward compatibility
              plan_tier: "PRO",
              tt_org_id: org.id,  // New affiliate fields
              tt_affiliate_id: affiliate.id,
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");

      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify org upgraded (same as flag OFF - metadata.organization_id still works)
      const upgraded = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
      expect(upgraded?.stripe_customer_id).toBe("cus_test_on");
      expect(upgraded?.stripe_subscription_id).toBe("sub_test_on");
    });

    it("webhook upgrades non-referred org with organization_id only", async () => {
      // Create user and non-referred org
      const user = await prisma.user.create({
        data: {
          email: `nonref-webhook-on${Date.now()}@example.com`,
          password_hash: "hash",
        },
      });
      testUserIds.push(user.id);

      const org = await prisma.organization.create({
        data: {
          name: "Non-Referred Org Webhook ON",
          plan_tier: "FREE",
          memberships: {
            create: {
              user_id: user.id,
              role: "OWNER",
            },
          },
        },
      });
      testOrgIds.push(org.id);

      // Build webhook event without affiliate metadata (non-referred org)
      const timestamp = Date.now();
      const event = {
        id: `evt_nonref_on_${timestamp}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_nonref_on_${timestamp}`,
            customer: `cus_nonref_on_${timestamp}`,
            subscription: `sub_nonref_on_${timestamp}`,
            metadata: {
              organization_id: org.id,  // Only organization_id, no tt_* fields
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const webhookTimestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${webhookTimestamp}.${payload}`;
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");

      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${webhookTimestamp},v1=${signature}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify org upgraded (metadata.organization_id works regardless of affiliate status)
      const upgraded = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
      expect(upgraded?.stripe_customer_id).toBe(`cus_nonref_on_${timestamp}`);
      expect(upgraded?.stripe_subscription_id).toBe(`sub_nonref_on_${timestamp}`);
    });
  });
});
