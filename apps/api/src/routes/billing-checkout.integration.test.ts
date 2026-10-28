/**
 * Billing checkout-to-webhook integration test
 * Tests the full flow: checkout route call -> Stripe SDK -> webhook delivery -> org upgrade
 * Mocks ONLY Stripe SDK network methods to capture and verify checkout args
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import crypto from "node:crypto";
import type Stripe from "stripe";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

// Mock Stripe at module level
let capturedCheckoutArgs: Stripe.Checkout.SessionCreateParams | null = null;
let mockCheckoutSessionsCreate: ReturnType<typeof vi.fn>;
let mockCustomersCreate: ReturnType<typeof vi.fn>;
let mockCustomersRetrieve: ReturnType<typeof vi.fn>;
let mockCustomersUpdate: ReturnType<typeof vi.fn>;
let mockSubscriptionsRetrieve: ReturnType<typeof vi.fn>;
let subscriptionPeriodEndUnix: number;

vi.mock("stripe", () => {
  const mockStripe = vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args),
      },
    },
    customers: {
      create: (...args: unknown[]) => mockCustomersCreate(...args),
      retrieve: (...args: unknown[]) => mockCustomersRetrieve(...args),
      update: (...args: unknown[]) => mockCustomersUpdate(...args),
    },
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
    },
    webhooks: {
      constructEvent: (payload: Buffer | string, _sig: string, _secret: string) => {
        // Simple signature verification for tests
        const payloadStr = typeof payload === "string" ? payload : payload.toString();
        return JSON.parse(payloadStr);
      },
    },
  }));
  return { default: mockStripe };
});

testSuite("Billing Checkout Integration", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  const testOrgIds: string[] = [];
  const testAffiliateIds: string[] = [];
  const testWebhookEventIds: string[] = [];
  const webhookSecret = "whsec_test_billing";

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_PRICE_PRO = "price_test_pro";
    process.env.TELEMETRY_DASHBOARD_ORIGIN = "https://test.example.com";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
  });

  beforeEach(async () => {
    // Reset mocks
    capturedCheckoutArgs = null;
    
    mockCheckoutSessionsCreate = vi.fn().mockImplementation(async (params) => {
      capturedCheckoutArgs = params;
      return {
        id: `cs_${Date.now()}`,
        url: "https://checkout.stripe.com/test",
        customer: params.customer || `cus_${Date.now()}`,
        subscription: `sub_${Date.now()}`,
        metadata: params.metadata,
      };
    });

    mockCustomersCreate = vi.fn().mockResolvedValue({ id: `cus_${Date.now()}` });
    
    mockCustomersRetrieve = vi.fn().mockResolvedValue({
      id: "cus_existing",
      deleted: false,
      metadata: {},
    });
    
    mockCustomersUpdate = vi.fn().mockImplementation(async (id, params) => ({
      id,
      ...params,
    }));
    
    // stripe@22 SDK default API (2026-03-25.dahlia): period end lives only on
    // subscription items, not on the Subscription itself.
    subscriptionPeriodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
      id: "sub_test",
      object: "subscription",
      status: "active",
      items: {
        object: "list",
        data: [{ id: "si_test", current_period_end: subscriptionPeriodEndUnix }],
      },
    });

    // Create app for each test to pick up env changes
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    if (testWebhookEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { id: { in: testWebhookEventIds } },
      }).catch(() => undefined);
    }
    if (testAffiliateIds.length > 0) {
      await prisma.affiliateAdjustment.deleteMany({
        where: { affiliate_id: { in: testAffiliateIds } },
      });
      await prisma.affiliateCommission.deleteMany({
        where: { affiliate_id: { in: testAffiliateIds } },
      });
      await prisma.affiliatePayout.deleteMany({
        where: { affiliate_id: { in: testAffiliateIds } },
      });
    }
    if (testOrgIds.length > 0) {
      await prisma.affiliateCommission.deleteMany({
        where: { organization_id: { in: testOrgIds } },
      });
      await prisma.organizationReferral.deleteMany({
        where: { organization_id: { in: testOrgIds } },
      });
      await prisma.userReferral.deleteMany({
        where: { attributed_organization_id: { in: testOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: testOrgIds } },
      });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      });
    }
    if (testAffiliateIds.length > 0) {
      await prisma.affiliate.deleteMany({
        where: { id: { in: testAffiliateIds } },
      });
    }
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_PRO;
    delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    delete process.env.TELEMETRY_ALLOW_REGISTRATION;
  });

  describe("Flag OFF - Checkout and Webhook", () => {
    beforeAll(() => {
      delete process.env.AFFILIATES_ENABLED;
    });

    it("checkout args match develop (organization_id only, no allow_promotion_codes, no tt_*)", async () => {
      // Register user
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `checkout-off${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Test Org OFF" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Call real checkout route
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(mockCheckoutSessionsCreate).toHaveBeenCalled();
      expect(capturedCheckoutArgs).toBeTruthy();

      // Verify flag-OFF args deep-equal develop's shape
      expect(capturedCheckoutArgs?.allow_promotion_codes).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.plan_tier).toBe("PRO");
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBeUndefined();
      expect(capturedCheckoutArgs?.subscription_data?.metadata?.organization_id).toBe(orgId);

      // Build webhook event from captured args
      const session = await mockCheckoutSessionsCreate.mock.results[0]?.value;
      const event = {
        id: `evt_test_off_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: session.id,
            customer: session.customer,
            subscription: session.subscription,
            metadata: capturedCheckoutArgs?.metadata,
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

      // Send webhook
      const webhookResponse = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        payload,
      });

      expect(webhookResponse.statusCode).toBe(200);

      // Verify org upgraded
      const upgraded = await prisma.organization.findUnique({
        where: { id: orgId },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
      expect(upgraded?.stripe_customer_id).toBeTruthy();
      expect(upgraded?.stripe_subscription_id).toBeTruthy();
      // Status + period end come from subscriptions.retrieve (dahlia shape: items only)
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith(session.subscription);
      expect(upgraded?.stripe_subscription_status).toBe("active");
      expect(upgraded?.stripe_current_period_end?.getTime()).toBe(
        subscriptionPeriodEndUnix * 1000
      );
    });
  });

  describe("Flag ON - Checkout and Webhook", () => {
    beforeAll(() => {
      process.env.AFFILIATES_ENABLED = "true";
    });

    afterAll(() => {
      delete process.env.AFFILIATES_ENABLED;
    });

    it("referred org: reuses stripe_customer_id, metadata has organization_id + tt_org_id", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          code: `token-on-${Date.now()}`,
          name: "Checkout Affiliate",
          email: "aff@example.com",
          email_normalized: "aff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register referred user
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `referred${Date.now()}@example.com`,
          password: "Password123!",
          referralCode: affiliate.code,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create org (will be attributed)
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Referred Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true },
      });
      expect(org?.stripe_customer_id).toBeTruthy();
      const createCallsBeforeCheckout = mockCustomersCreate.mock.calls.length;

      // Call real checkout route
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs).toBeTruthy();

      // Verify flag-ON args for referred org (no allow_promotion_codes, matches develop)
      expect(capturedCheckoutArgs?.allow_promotion_codes).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
      expect(capturedCheckoutArgs?.customer).toBe(org!.stripe_customer_id);
      expect(mockCustomersCreate.mock.calls.length).toBe(createCallsBeforeCheckout);

      // Build and send webhook from captured args
      const session = await mockCheckoutSessionsCreate.mock.results[0]?.value;
      const event = {
        id: `evt_test_on_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: session.id,
            customer: session.customer,
            subscription: session.subscription,
            metadata: capturedCheckoutArgs?.metadata,
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

      const webhookResponse = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        payload,
      });

      expect(webhookResponse.statusCode).toBe(200);

      const upgraded = await prisma.organization.findUnique({
        where: { id: orgId },
      });
      expect(upgraded?.plan_tier).toBe("PRO");
    });

    it("non-referred org: checkout args identical to flag OFF", async () => {
      // Register user WITHOUT referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `nonref${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Non-Referred Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Call real checkout route
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs).toBeTruthy();

      // Verify args identical to flag OFF (checkout matches develop for non-referred orgs)
      expect(capturedCheckoutArgs?.allow_promotion_codes).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBeUndefined();
    });
  });
});
