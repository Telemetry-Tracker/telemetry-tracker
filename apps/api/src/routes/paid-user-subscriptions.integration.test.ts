/**
 * Existing paid user subscription management tests
 * 
 * Tests what happens when organizations with active subscriptions attempt to:
 * - Click "Upgrade to Pro" when already on PRO (should not create duplicate)
 * - Click "Upgrade to Business" when already on PRO (should upgrade)
 * - Click "Upgrade to Pro" when already on BUSINESS (downgrade - behavior TBD)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

// Mock Stripe
let mockCheckoutSessionsCreate: ReturnType<typeof vi.fn>;
let mockCustomersCreate: ReturnType<typeof vi.fn>;
let mockCustomersRetrieve: ReturnType<typeof vi.fn>;
let mockCustomersUpdate: ReturnType<typeof vi.fn>;
let mockSubscriptionsList: ReturnType<typeof vi.fn>;
let mockSubscriptionsRetrieve: ReturnType<typeof vi.fn>;

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
      list: (...args: unknown[]) => mockSubscriptionsList(...args),
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
    },
    webhooks: {
      constructEvent: (payload: Buffer | string, _sig: string, _secret: string) => {
        const payloadStr = typeof payload === "string" ? payload : payload.toString();
        return JSON.parse(payloadStr);
      },
    },
  }));
  return { default: mockStripe };
});

testSuite("Existing Paid User Subscription Tests", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  const testOrgIds: string[] = [];
  let checkoutCallCount = 0;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_existing_paid";
    process.env.STRIPE_PRICE_PRO = "price_test_pro";
    process.env.STRIPE_PRICE_BUSINESS = "price_test_business";
    process.env.TELEMETRY_DASHBOARD_ORIGIN = "https://test.example.com";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
  });

  beforeEach(async () => {
    checkoutCallCount = 0;

    mockCheckoutSessionsCreate = vi.fn().mockImplementation(async (params) => {
      checkoutCallCount++;
      return {
        id: `cs_existing_${checkoutCallCount}`,
        url: `https://checkout.stripe.com/existing_${checkoutCallCount}`,
        customer: params.customer,
        subscription: `sub_existing_${checkoutCallCount}`,
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

    // Mock active subscriptions list
    mockSubscriptionsList = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        {
          id: "sub_active_pro",
          status: "active",
          items: {
            data: [{ price: { id: "price_test_pro" } }],
          },
        },
      ],
    });

    const subscriptionPeriodEndUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
      id: "sub_test",
      object: "subscription",
      status: "active",
      items: {
        object: "list",
        data: [{ id: "si_test", current_period_end: subscriptionPeriodEndUnix }],
      },
    });

    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    if (testOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: testOrgIds } },
      });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      });
    }
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_PRO;
    delete process.env.STRIPE_PRICE_BUSINESS;
    delete process.env.TELEMETRY_DASHBOARD_ORIGIN;
    delete process.env.TELEMETRY_ALLOW_REGISTRATION;
  });

  async function createPaidOrg(planTier: "PRO" | "BUSINESS") {
    const email = `paid-${planTier.toLowerCase()}-${Date.now()}@example.com`;
    const regResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email,
        password: "Password123!",
      },
    });
    const { user, sessionId } = JSON.parse(regResponse.body);
    testUserIds.push(user.id);

    const orgResponse = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name: `${planTier} Org` },
    });
    const { id: orgId } = JSON.parse(orgResponse.body);
    testOrgIds.push(orgId);

    // Simulate existing subscription by updating org
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        plan_tier: planTier,
        stripe_customer_id: `cus_${planTier.toLowerCase()}_${Date.now()}`,
        stripe_subscription_id: `sub_${planTier.toLowerCase()}_active`,
        stripe_subscription_status: "active",
      },
    });

    return { orgId, sessionId, userId: user.id };
  }

  describe("PRO org selecting Pro again", () => {
    it("should reject with 'already on plan' error", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      const body = JSON.parse(checkoutResponse.body);
      expect(body.error).toContain("already on the PRO plan");
      expect(body.code).toBe("ALREADY_ON_PLAN");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ PRO→PRO: API blocks same-tier with ALREADY_ON_PLAN");
    });
  });

  describe("PRO org upgrading to Business", () => {
    it("should block and direct to billing portal (prevents double-billing)", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      // NEW BEHAVIOR: Block checkout, direct to portal
      expect(checkoutResponse.statusCode).toBe(400);
      const body = JSON.parse(checkoutResponse.body);
      expect(body.error).toContain("billing portal");
      expect(body.code).toBe("USE_BILLING_PORTAL");
      expect(body.details?.currentPlan).toBe("PRO");
      expect(body.details?.requestedPlan).toBe("BUSINESS");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ PRO→BUSINESS: API blocks checkout, directs to portal (no double-billing)");
    });
  });

  describe("BUSINESS org selecting Business again", () => {
    it("should reject with 'already on plan' error", async () => {
      const { orgId, sessionId } = await createPaidOrg("BUSINESS");

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      const body = JSON.parse(checkoutResponse.body);
      expect(body.error).toContain("already on the BUSINESS plan");
      expect(body.code).toBe("ALREADY_ON_PLAN");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ BUSINESS→BUSINESS: API blocks same-tier");
    });
  });

  describe("BUSINESS org selecting Pro", () => {
    it("should block and direct to billing portal", async () => {
      const { orgId, sessionId } = await createPaidOrg("BUSINESS");

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      const body = JSON.parse(checkoutResponse.body);
      expect(body.error).toContain("billing portal");
      expect(body.code).toBe("USE_BILLING_PORTAL");
      expect(body.details?.currentPlan).toBe("BUSINESS");
      expect(body.details?.requestedPlan).toBe("PRO");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ BUSINESS→PRO: API blocks, directs to portal");
    });
  });

  describe("Past due and incomplete subscription states", () => {
    it("blocks checkout for past_due subscription", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");
      
      // Update to past_due status
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_subscription_status: "past_due" },
      });

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).code).toBe("USE_BILLING_PORTAL");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ past_due: API blocks checkout, directs to portal");
    });

    it("blocks checkout for incomplete subscription", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");
      
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_subscription_status: "incomplete" },
      });

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).code).toBe("USE_BILLING_PORTAL");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ incomplete: API blocks checkout, directs to portal");
    });

    it("blocks checkout for unpaid subscription", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");
      
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_subscription_status: "unpaid" },
      });

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).code).toBe("USE_BILLING_PORTAL");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ unpaid: API blocks checkout, directs to portal");
    });
  });
});
