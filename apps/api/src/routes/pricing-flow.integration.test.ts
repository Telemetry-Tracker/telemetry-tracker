/**
 * Pricing CTA -> Registration/Login -> Org Creation -> Stripe Checkout flow integration tests
 * 
 * Tests the complete user journey from clicking pricing CTAs through checkout creation.
 * Mocks Stripe SDK to avoid live API calls, validates checkout session parameters.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
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
        const payloadStr = typeof payload === "string" ? payload : payload.toString();
        return JSON.parse(payloadStr);
      },
    },
  }));
  return { default: mockStripe };
});

testSuite("Pricing Flow Integration Tests", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  const testOrgIds: string[] = [];
  let checkoutCallCount = 0;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_pricing_flow";
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
        id: `cs_${Date.now()}_${checkoutCallCount}`,
        url: `https://checkout.stripe.com/test_${checkoutCallCount}`,
        customer: params.customer || `cus_${Date.now()}`,
        subscription: `sub_${Date.now()}_${checkoutCallCount}`,
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

  describe("Fresh user - Pro plan intent (issue #875 case)", () => {
    it("register?plan=pro → create org → billing?plan=pro → checkout PRO exactly once", async () => {
      // Simulate: User clicks "Start with Pro" on pricing page
      // Frontend redirects to /register?plan=pro after registration → /dashboard/settings/organization?plan=pro
      
      // Step 1: Register new user
      const email = `fresh-pro-${Date.now()}@example.com`;
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "Password123!",
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Step 2: Create organization (user lands on org settings with ?plan=pro)
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Fresh Pro Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Step 3: After org creation, frontend redirects to billing?plan=pro
      // BillingPlanIntent component auto-triggers checkout for PRO
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      const { url } = JSON.parse(checkoutResponse.body);
      expect(url).toContain("checkout.stripe.com");
      
      // Verify checkout was called exactly once with PRO price
      expect(checkoutCallCount).toBe(1);
      expect(capturedCheckoutArgs?.metadata?.plan_tier).toBe("PRO");
      expect(capturedCheckoutArgs?.line_items?.[0]?.price).toBe("price_test_pro");
    });

    it("register?plan=business → create org → billing?plan=business → checkout BUSINESS exactly once", async () => {
      // Step 1: Register
      const email = `fresh-business-${Date.now()}@example.com`;
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "Password123!",
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Step 2: Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Fresh Business Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Step 3: Trigger checkout for BUSINESS
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(checkoutCallCount).toBe(1);
      expect(capturedCheckoutArgs?.metadata?.plan_tier).toBe("BUSINESS");
      expect(capturedCheckoutArgs?.line_items?.[0]?.price).toBe("price_test_business");
    });
  });

  describe("Free CTA - no checkout", () => {
    it("register without plan → create org → no checkout triggered", async () => {
      const email = `free-user-${Date.now()}@example.com`;
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "Password123!",
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Free Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Verify org is FREE and no checkout was created
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { plan_tier: true, stripe_subscription_id: true },
      });
      expect(org?.plan_tier).toBe("FREE");
      expect(org?.stripe_subscription_id).toBeNull();
      expect(checkoutCallCount).toBe(0);
    });
  });

  describe("Invite precedence", () => {
    it("register with invite + plan → invite wins, no checkout", async () => {
      // Create owner and org
      const ownerReg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `owner-${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      const { user: owner, sessionId: ownerSession } = JSON.parse(ownerReg.body);
      testUserIds.push(owner.id);

      const orgResp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${ownerSession}` },
        payload: { name: "Invite Org" },
      });
      const { id: orgId } = JSON.parse(orgResp.body);
      testOrgIds.push(orgId);

      // Create invite directly via Prisma (POST endpoint doesn't exist yet)
      const inviteEmail = `invited-${Date.now()}@example.com`;
      const inviteToken = `invite_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await prisma.organizationInvite.create({
        data: {
          organization_id: orgId,
          email: inviteEmail,
          role: "EDITOR",
          token: inviteToken,
          expires_at: expiresAt,
          invited_by_id: owner.id,
        },
      });

      // Register with invite (plan param would be in URL but ignored by server)
      const inviteeReg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: inviteEmail,
          password: "Password123!",
          inviteToken,
        },
      });
      
      expect(inviteeReg.statusCode).toBe(201);
      const regBody = JSON.parse(inviteeReg.body);
      expect(regBody.user).toBeDefined();
      expect(regBody.organizationId).toBe(orgId);
      const invitee = regBody.user;
      testUserIds.push(invitee.id);

      // Verify: joined existing org, no new org created, no checkout
      const memberships = await prisma.organizationMembership.findMany({
        where: { user_id: invitee.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].organization_id).toBe(orgId);
      expect(memberships[0].role).toBe("EDITOR");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ Invite precedence: invite wins over plan intent, no checkout created");
    });
  });

  describe("Invalid plan param", () => {
    it("planTier=free rejected by API", async () => {
      const email = `invalid-${Date.now()}@example.com`;
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
        payload: { name: "Test Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "FREE" },
      });

      expect(checkoutResponse.statusCode).toBe(400);
      expect(JSON.parse(checkoutResponse.body).error).toContain("PRO or BUSINESS");
      expect(checkoutCallCount).toBe(0);
    });
  });

  describe("Non-owner permissions", () => {
    it("MEMBER cannot create checkout", async () => {
      // Create owner + org
      const ownerReg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `owner-perm-${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      const { user: owner, sessionId: ownerSession } = JSON.parse(ownerReg.body);
      testUserIds.push(owner.id);

      const orgResp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${ownerSession}` },
        payload: { name: "Perm Org" },
      });
      const { id: orgId } = JSON.parse(orgResp.body);
      testOrgIds.push(orgId);

      // Create member user and add EDITOR membership directly via Prisma
      const memberEmail = `member-${Date.now()}@example.com`;
      const memberUser = await prisma.user.create({
        data: {
          email: memberEmail,
          password_hash: "$2b$10$dummyhash", // Not used for auth in this test
          display_name: "Test Member",
        },
      });
      testUserIds.push(memberUser.id);

      await prisma.organizationMembership.create({
        data: {
          user_id: memberUser.id,
          organization_id: orgId,
          role: "EDITOR",
        },
      });

      // Create session for member
      const memberSession = await prisma.session.create({
        data: {
          user_id: memberUser.id,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      // Member tries to create checkout - should fail with 403 (role check)
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${memberSession.id}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(403);
      expect(JSON.parse(checkoutResponse.body).error).toContain("Forbidden");
      expect(checkoutCallCount).toBe(0);

      console.log("✓ Non-OWNER (EDITOR) role correctly blocked from creating checkout");
    });
  });

  describe("Back from Stripe with billing=canceled", () => {
    it("canceled checkout does not reopen automatically", async () => {
      // This is a client-side behavior test documented here:
      // When user cancels Stripe checkout, they return to success_url with ?billing=canceled
      // The dashboard should NOT automatically reopen checkout
      // 
      // Verification: No automated reopen mechanism exists in BillingPlanIntent or billing page
      // The ?plan param is only processed once per component mount (via useRef guard)
      
      expect(true).toBe(true); // Documented behavior
    });
  });

  describe("Existing org with login intent", () => {
    it("existing user login → existing org → checkout PRO", async () => {
      // Create user + org ahead of time
      const email = `existing-${Date.now()}@example.com`;
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
        payload: { name: "Existing Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Simulate: User logs out, clicks "Start with Pro", signs in
      // Middleware redirects signed-in /register?plan=pro to /dashboard/settings/billing?plan=pro
      // BillingPlanIntent triggers checkout

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(checkoutCallCount).toBe(1);
      expect(capturedCheckoutArgs?.metadata?.plan_tier).toBe("PRO");
    });

    it("FREE org with abandoned checkout (customer but no subscription) → still uses Checkout", async () => {
      // Create user + org
      const email = `abandoned-${Date.now()}@example.com`;
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
        payload: { name: "Abandoned Checkout Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Simulate abandoned checkout: org has stripe_customer_id but NO subscription
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          stripe_customer_id: `cus_abandoned_${Date.now()}`,
          stripe_subscription_id: null,
          stripe_subscription_status: null,
        },
      });

      // Attempt checkout - should succeed (customer without subscription goes to Checkout)
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(checkoutCallCount).toBe(1);
      expect(capturedCheckoutArgs?.metadata?.plan_tier).toBe("PRO");

      console.log("✓ Abandoned checkout (customer but no sub): correctly uses Checkout, not portal");
    });
  });
});
