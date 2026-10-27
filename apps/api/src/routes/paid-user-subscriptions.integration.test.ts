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
import type Stripe from "stripe";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

// Mock Stripe
let capturedCheckoutArgs: Stripe.Checkout.SessionCreateParams | null = null;
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
    capturedCheckoutArgs = null;
    checkoutCallCount = 0;

    mockCheckoutSessionsCreate = vi.fn().mockImplementation(async (params) => {
      capturedCheckoutArgs = params;
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
    it("should reject with 'already on this plan' error", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");

      // User on PRO tries to click "Upgrade to Pro" (blocked by UI, but could happen via direct URL)
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      // NEW BEHAVIOR: API blocks duplicate subscription
      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).error).toContain("already on the PRO plan");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ PRO→PRO: API blocks duplicate subscription");
    });
  });

  describe("PRO org upgrading to Business", () => {
    it("creates checkout for BUSINESS (allowed upgrade path)", async () => {
      const { orgId, sessionId } = await createPaidOrg("PRO");

      // User on PRO clicks "Upgrade to Business"
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      // This is expected behavior: upgrade from PRO to BUSINESS
      expect(checkoutResponse.statusCode).toBe(200);
      expect(checkoutCallCount).toBe(1);
      expect(capturedCheckoutArgs?.metadata?.plan_tier).toBe("BUSINESS");
      expect(capturedCheckoutArgs?.line_items?.[0]?.price).toBe("price_test_business");

      console.log("✓ PRO→BUSINESS: API creates checkout (expected upgrade path)");
    });
  });

  describe("BUSINESS org selecting Business again", () => {
    it("should reject with 'already on this plan' error", async () => {
      const { orgId, sessionId } = await createPaidOrg("BUSINESS");

      // User on BUSINESS tries to click "Upgrade to Business" (blocked by UI, but could happen via direct URL)
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      // NEW BEHAVIOR: API blocks duplicate subscription
      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).error).toContain("already on the BUSINESS plan");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ BUSINESS→BUSINESS: API blocks duplicate subscription");
    });
  });

  describe("BUSINESS org selecting Pro", () => {
    it("should reject downgrade with clear error message", async () => {
      const { orgId, sessionId } = await createPaidOrg("BUSINESS");

      // User on BUSINESS tries to get PRO (downgrade - not supported)
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      // NEW BEHAVIOR: API blocks downgrade
      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).error).toContain("Downgrading");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ BUSINESS→PRO: API blocks downgrade with clear error");
    });
  });
});
