/**
 * Affiliate program integration tests
 * Run with: RUN_DB_INTEGRATION_TESTS=true pnpm test affiliates.integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { AFFILIATE_RESOLVE_AUDIT_ACTION } from "../lib/resolve-needs-attention.js";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import crypto from "node:crypto";
import type Stripe from "stripe";
import {
  applyAffiliateTestEnv,
  cleanupAffiliateFixtures,
  normalizeCheckoutArgs,
  referralCapturedAtDaysAgo,
  REFERRAL_ATTRIBUTION_WINDOW_DAYS,
  restoreEnv,
  signRewardfulPayload,
  signStripeEvent,
  snapshotEnv,
  STRIPE_PRICE_BUSINESS_TEST,
  STRIPE_PRICE_PRO_TEST,
  uniqueReferralUuid,
} from "./affiliate-test-helpers.js";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

let capturedCheckoutArgs: Stripe.Checkout.SessionCreateParams | null = null;
let mockCheckoutSessionsCreate: ReturnType<typeof vi.fn>;
let mockCustomersCreate: ReturnType<typeof vi.fn>;
let mockCustomersRetrieve: ReturnType<typeof vi.fn>;
let mockCustomersUpdate: ReturnType<typeof vi.fn>;
let mockSubscriptionsRetrieve: ReturnType<typeof vi.fn>;
let mockChargesRetrieve: ReturnType<typeof vi.fn>;

function resetStripeMocks() {
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
  mockCustomersCreate = vi.fn().mockImplementation(async (params) => ({
    id: `cus_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    metadata: params?.metadata ?? {},
  }));
  mockCustomersRetrieve = vi.fn().mockImplementation(async (id) => ({
    id,
    deleted: false,
    metadata: {},
  }));
  mockCustomersUpdate = vi.fn().mockImplementation(async (id, params) => ({
    id,
    ...params,
  }));
  mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
    id: "sub_test",
    status: "active",
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  });
  mockChargesRetrieve = vi.fn().mockResolvedValue({
    id: "ch_test",
    customer: "cus_test",
  });
}

resetStripeMocks();

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
    charges: {
      retrieve: (...args: unknown[]) => mockChargesRetrieve(...args),
    },
    webhooks: {
      constructEvent: (payload: Buffer | string) => {
        const payloadStr = typeof payload === "string" ? payload : payload.toString();
        return JSON.parse(payloadStr);
      },
    },
  }));
  return { default: mockStripe };
});

testSuite("Affiliate Integration Tests", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  const testOrgIds: string[] = [];
  const testAffiliateIds: string[] = [];
  const testWebhookEventKeys: string[] = [];
  const testCommissionIds: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    originalEnv = snapshotEnv();
    applyAffiliateTestEnv();
    resetStripeMocks();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await cleanupAffiliateFixtures(prisma, {
      userIds: testUserIds,
      orgIds: testOrgIds,
      affiliateIds: testAffiliateIds,
      webhookEventKeys: testWebhookEventKeys,
      commissionIds: testCommissionIds,
    });
    await app.close();
    restoreEnv(originalEnv);
  });

  beforeEach(async () => {
    resetStripeMocks();
    await cleanupAffiliateFixtures(prisma, {
      userIds: testUserIds,
      orgIds: testOrgIds,
      affiliateIds: testAffiliateIds,
      webhookEventKeys: testWebhookEventKeys,
      commissionIds: testCommissionIds,
    });
  });

  describe("Registration and Referral Capture", () => {
    it("captures valid referral at registration", async () => {
      // Create test affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: "aff_test_valid",
          link_token: "testtoken",
          email_normalized: "affiliate@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `user${Date.now()}@example.com`,
          password: "Password123!",
          displayName: "Test User",
          rewardfulReferralId: "00000000-0000-4000-8000-000000000001",
          viaToken: "testtoken",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      testUserIds.push(body.user.id);

      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: body.user.id },
      });
      expect(userReferral).toBeTruthy();
      expect(userReferral?.affiliate_id).toBe(affiliate.id);
      expect(userReferral?.via_token).toBe("testtoken");
    });

    it("ignores invalid referral formats", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `user${Date.now()}@example.com`,
          password: "Password123!",
          displayName: "Test User",
          rewardfulReferralId: "not-a-uuid",
          viaToken: "invalid token with spaces!",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      testUserIds.push(body.user.id);

      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: body.user.id },
      });
      expect(userReferral).toBeNull();
    });

    it("rejects self-referral at registration", async () => {
      const userEmail = `selfref${Date.now()}@example.com`;
      
      // Create affiliate with same normalized email
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: "aff_self_ref",
          link_token: "selftoken",
          email_normalized: userEmail.toLowerCase(),
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: userEmail,
          password: "Password123!",
          viaToken: "selftoken",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      testUserIds.push(body.user.id);

      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: body.user.id },
      });
      expect(userReferral).toBeNull(); // Self-referral rejected
    });

    it("keeps a valid UUID as UNRESOLVED when via-token affiliate has no email", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_noemail_reg_${Date.now()}`,
          link_token: `noemail_reg_${Date.now()}`,
          email_normalized: null,
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `noemail-reg-${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
          rewardfulReferralId: referralUuid,
        },
      });
      expect(response.statusCode).toBe(201);
      const { user } = JSON.parse(response.body);
      testUserIds.push(user.id);

      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(userReferral).toBeTruthy();
      expect(userReferral?.rewardful_referral_id).toBe(referralUuid);
      expect(userReferral?.via_token).toBe(affiliate.link_token);
      expect(userReferral?.affiliate_id).toBeNull();
      expect(userReferral?.status).toBe("UNRESOLVED");
    });
  });

  describe("Organization Attribution", () => {
    it("attributes first org as OWNER", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_first_org_${Date.now()}`,
          link_token: `firstorg${Date.now()}`,
          email_normalized: "aff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register user with referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `firstorg${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
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
        payload: { name: "First Org" },
      });

      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral).toBeTruthy();
      expect(orgReferral?.affiliate_id).toBe(affiliate.id);
    });

    it("does not attribute second org", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_second_org_${Date.now()}`,
          link_token: `secondorg${Date.now()}`,
          email_normalized: "aff2@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register user with referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `secondorg${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create first org
      const org1Response = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "First Org" },
      });
      const { id: org1Id } = JSON.parse(org1Response.body);
      testOrgIds.push(org1Id);

      // Create second org
      const org2Response = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Second Org" },
      });
      const { id: org2Id } = JSON.parse(org2Response.body);
      testOrgIds.push(org2Id);

      // Check first org has referral
      const org1Referral = await prisma.organizationReferral.findUnique({
        where: { organization_id: org1Id },
      });
      expect(org1Referral).toBeTruthy();

      // Check second org has no referral
      const org2Referral = await prisma.organizationReferral.findUnique({
        where: { organization_id: org2Id },
      });
      expect(org2Referral).toBeNull();
    });

    it("captured_at exactly 60 days ago remains ACTIVE / attributed", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_window_${Date.now()}`,
          link_token: `windowtoken${Date.now()}`,
          email_normalized: "window@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `window${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Inclusive boundary (`>` not `>=`): +1s so org-create latency cannot cross expiry.
      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { captured_at: referralCapturedAtDaysAgo(REFERRAL_ATTRIBUTION_WINDOW_DAYS, 1000) },
      });

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Window Boundary Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral).toBeTruthy();
      expect(orgReferral?.status).toBe("ACTIVE");
      expect(orgReferral?.affiliate_id).toBe(affiliate.id);
      expect(orgReferral?.needs_attention).toBe(false);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true },
      });
      expect(org?.stripe_customer_id).toBeTruthy();

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
    });

    it("captured_at 61 days ago is EXPIRED with no tt_* at checkout", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_expired_${Date.now()}`,
          link_token: `expiredtoken${Date.now()}`,
          email_normalized: "expired@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `expired${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { captured_at: referralCapturedAtDaysAgo(REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1) },
      });

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Expired Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral).toBeTruthy();
      expect(orgReferral?.status).toBe("EXPIRED");
      expect(orgReferral?.needs_attention).toBe(true);
      expect(orgReferral?.attention_reason).toBe(
        `referral_expired_${REFERRAL_ATTRIBUTION_WINDOW_DAYS}_days`
      );

      const existingCustomerId = `cus_expired_boundary_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: existingCustomerId },
      });
      mockCustomersUpdate.mockClear();
      mockCustomersCreate.mockClear();

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.customer).toBe(existingCustomerId);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
      expect(mockCustomersUpdate).not.toHaveBeenCalled();
      expect(mockCustomersCreate).not.toHaveBeenCalled();
    });
  });

  describe("Feature Flag OFF", () => {
    let flagOffApp: FastifyInstance;

    beforeAll(async () => {
      delete process.env.AFFILIATES_ENABLED;
      process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
      flagOffApp = await createApp();
      await flagOffApp.ready();
    });

    afterAll(async () => {
      await flagOffApp.close();
      process.env.AFFILIATES_ENABLED = "true";
    });

    it("ignores referral fields when flag is OFF", async () => {
      const response = await flagOffApp.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `flagoff${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: "00000000-0000-4000-8000-000000000001",
          viaToken: "ignored",
        },
      });

      expect(response.statusCode).toBe(201);
      const { user } = JSON.parse(response.body);
      testUserIds.push(user.id);

      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(userReferral).toBeNull();
    });

    it("returns 404 for resolve-needs-attention when flag is OFF", async () => {
      const response = await flagOffApp.inject({
        method: "POST",
        url: "/api/meta/affiliates/organizations/00000000-0000-4000-8000-000000000099/resolve-needs-attention",
        payload: { reason: "Should not be reachable" },
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 404 for Rewardful webhook when flag is OFF", async () => {
      const payload = {
        event: {
          id: `evt_flagoff_${Date.now()}`,
          type: "referral.converted",
        },
        object: {
          id: "ref_test",
          affiliate: { id: "aff_test" },
          state: "converted",
        },
      };

      const response = await flagOffApp.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(payload),
          "content-type": "application/json",
        },
        payload,
      });

      expect(response.statusCode).toBe(404);
    });

    it("signed Stripe checkout.session.completed writes zero WebhookEvent rows and still upgrades", async () => {
      const regResponse = await flagOffApp.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `flagoffstripe${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await flagOffApp.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Flag Off Stripe Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const eventId = `evt_flagoff_stripe_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const event = {
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_flagoff_${Date.now()}`,
            customer: `cus_flagoff_${Date.now()}`,
            subscription: `sub_flagoff_${Date.now()}`,
            metadata: {
              organization_id: orgId,
              plan_tier: "PRO",
            },
          },
        },
      };
      const { payload, header } = signStripeEvent(event);

      const webhookResponse = await flagOffApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": header,
        },
        payload,
      });
      expect(webhookResponse.statusCode).toBe(200);

      const events = await prisma.webhookEvent.findMany({
        where: { event_id: eventId },
      });
      expect(events).toHaveLength(0);

      const upgraded = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(upgraded?.plan_tier).toBe("PRO");
    });
  });

  // Webhook deduplication is tested in webhook-dedupe.test.ts at the unit level
  // Route-level integration testing of Stripe webhooks would require mocking Stripe SDK

  describe("Organization Attribution Error Handling", () => {
    it("creates org successfully even if attribution fails", async () => {
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `attrerr${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: uniqueReferralUuid(),
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      mockCustomersCreate.mockRejectedValueOnce(new Error("stripe customers.create failed"));

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Attribution Error Test Org" },
      });

      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
      });
      expect(org).not.toBeNull();
      expect(org?.name).toBe("Attribution Error Test Org");
      expect(org?.stripe_customer_id).toBeNull();

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral).toBeTruthy();
      expect(orgReferral?.attention_reason).toContain("customer_creation_failed");
    });
  });

  describe("Last-click attribution", () => {
    it("UUID is stored but only token resolves locally; customers.create gets UUID in metadata.referral", async () => {
      // Create affiliate with link token
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_token_${Date.now()}`,
          link_token: `valid_token_${Date.now()}`,
          email_normalized: "affiliate@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Create a distinct referral UUID (NOT an affiliate id)
      const referralUuid = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`;

      // Register with both token and UUID
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `uuidtoken${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
          rewardfulReferralId: referralUuid,
        },
      });

      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Verify: token resolved to affiliate, UUID stored
      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(userReferral?.affiliate_id).toBe(affiliate.id); // Resolved from token
      expect(userReferral?.rewardful_referral_id).toBe(referralUuid); // Stored
      expect(userReferral?.via_token).toBe(affiliate.link_token); // Stored
      expect(userReferral?.status).toBe("ACTIVE");

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "UUID Token Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      expect(mockCustomersCreate).toHaveBeenCalled();
      expect(mockCustomersCreate.mock.calls[0][0].metadata.referral).toBe(referralUuid);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.tt_affiliate_id).toBe(affiliate.id);

      // The ensureAffiliateCustomer call during org creation should have set metadata.referral = UUID
      // (We can't inspect the Stripe mock here, but the production code at organization-attribution.ts:305-310
      // prefers UUID over token when both are present)

      // Test tamper case: client sends an invalid format string as the UUID
      // Even if it looks like an affiliate id, it must pass UUID validation
      const invalidUuid = "not-a-valid-uuid-format";
      const tamperResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `tamper${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: invalidUuid, // Invalid UUID format
          viaToken: affiliate.link_token,
        },
      });
      expect(tamperResponse.statusCode).toBe(201);
      const { user: tamperUser } = JSON.parse(tamperResponse.body);
      testUserIds.push(tamperUser.id);

      // Verify: invalid UUID is rejected, but token still works
      const tamperReferral = await prisma.userReferral.findUnique({
        where: { user_id: tamperUser.id },
      });
      expect(tamperReferral?.affiliate_id).toBe(affiliate.id); // From token
      expect(tamperReferral?.rewardful_referral_id).toBeNull(); // Invalid UUID rejected
      expect(tamperReferral?.via_token).toBe(affiliate.link_token);
      expect(tamperReferral?.status).toBe("ACTIVE"); // From token resolution
      
      // Test with a valid UUID format that doesn't match any affiliate
      // This is the real tamper case: valid UUID format but wrong value
      const fakeUuid = `00000000-0000-4000-8000-999999999999`;
      const tamperResponse2 = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `tamper2${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: fakeUuid,
          viaToken: affiliate.link_token,
        },
      });
      expect(tamperResponse2.statusCode).toBe(201);
      const { user: tamperUser2 } = JSON.parse(tamperResponse2.body);
      testUserIds.push(tamperUser2.id);

      // Verify: UUID stored but only token resolves to affiliate
      const tamperReferral2 = await prisma.userReferral.findUnique({
        where: { user_id: tamperUser2.id },
      });
      expect(tamperReferral2?.affiliate_id).toBe(affiliate.id); // From token, NOT from UUID
      expect(tamperReferral2?.rewardful_referral_id).toBe(fakeUuid); // Stored as-is
      expect(tamperReferral2?.status).toBe("ACTIVE"); // From token resolution

      // Test token-only fallback: no UUID
      const tokenOnlyResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `tokenonly${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(tokenOnlyResponse.statusCode).toBe(201);
      const { user: tokenUser } = JSON.parse(tokenOnlyResponse.body);
      testUserIds.push(tokenUser.id);

      const tokenReferral = await prisma.userReferral.findUnique({
        where: { user_id: tokenUser.id },
      });
      expect(tokenReferral?.affiliate_id).toBe(affiliate.id);
      expect(tokenReferral?.rewardful_referral_id).toBeNull();
      expect(tokenReferral?.via_token).toBe(affiliate.link_token);
      expect(tokenReferral?.status).toBe("ACTIVE");
    });
  });

  describe("Attribution locked at signup", () => {
    it("later referral.converted for different affiliate doesn't change attribution", async () => {
      const affiliateA = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_first_${Date.now()}`,
          link_token: `token1_${Date.now()}`,
          email_normalized: "aff1@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliateA.id);

      const affiliateB = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_second_${Date.now()}`,
          email_normalized: "aff2@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliateB.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `locked${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliateA.link_token,
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Locked Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgRef1 = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef1?.affiliate_id).toBe(affiliateA.id);
      expect(orgRef1?.rewardful_referral_id).toBe(referralUuid);

      const eventId = `evt_switch_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: {
          id: eventId,
          type: "referral.converted",
        },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: { id: affiliateB.rewardful_affiliate_id, email: "aff2@example.com" },
        },
      };

      const webhookResponse = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(payload),
          "content-type": "application/json",
        },
        payload,
      });
      expect(webhookResponse.statusCode).toBe(200);

      const orgRef2 = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef2?.affiliate_id).toBe(affiliateA.id);
    });
  });

  describe("Duplicate Rewardful webhook", () => {
    it("same signed body posted twice is processed once", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_dup_${Date.now()}`,
          email_normalized: "aff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const eventId = `evt_dup_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: {
          id: eventId,
          type: "referral.converted",
        },
        object: {
          id: `ref_dup_${Date.now()}`,
          affiliate: { id: affiliate.rewardful_affiliate_id },
          state: "converted",
        },
      };

      const signature = crypto
        .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
        .update(JSON.stringify(payload))
        .digest("hex");

      // First post
      const resp1 = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signature,
          "content-type": "application/json",
        },
        payload,
      });
      expect(resp1.statusCode).toBe(200);

      // Second post (duplicate)
      const resp2 = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signature,
          "content-type": "application/json",
        },
        payload,
      });
      expect(resp2.statusCode).toBe(200);

      // Verify only one WebhookEvent was created
      const events = await prisma.webhookEvent.findMany({
        where: { event_id: eventId },
      });
      expect(events.length).toBe(1);
      expect(events[0].status).toBe("processed");
    });

    it("2 concurrent posts of same event are processed once", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_conc_${Date.now()}`,
          email_normalized: "concurrent@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `concurrent${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const eventId = `evt_conc_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: {
          id: eventId,
          type: "referral.converted",
        },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: {
            id: affiliate.rewardful_affiliate_id,
            email: "concurrent@example.com",
          },
        },
      };

      const signature = signRewardfulPayload(payload);

      const results = await Promise.all([
        app.inject({
          method: "POST",
          url: "/webhooks/rewardful",
          headers: {
            "x-rewardful-signature": signature,
            "content-type": "application/json",
          },
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/webhooks/rewardful",
          headers: {
            "x-rewardful-signature": signature,
            "content-type": "application/json",
          },
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/webhooks/rewardful",
          headers: {
            "x-rewardful-signature": signature,
            "content-type": "application/json",
          },
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/webhooks/rewardful",
          headers: {
            "x-rewardful-signature": signature,
            "content-type": "application/json",
          },
          payload,
        }),
      ]);

      const statusCodes = results.map((r) => r.statusCode);
      expect(statusCodes.every((code) => code === 200 || code === 409)).toBe(true);
      expect(statusCodes.some((code) => code === 200)).toBe(true);

      const events = await prisma.webhookEvent.findMany({
        where: { event_id: eventId },
      });
      expect(events.length).toBe(1);
      expect(events[0].status).toBe("processed");
      expect(events[0].attempts).toBe(1);

      const completed = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(completed?.affiliate_id).toBe(affiliate.id);
      expect(completed?.status).toBe("ACTIVE");
    });
  });

  describe("Free to Pro upgrade", () => {
    it("90+ day old referred org upgrading to Pro reuses customer and includes tt_* metadata", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_old_${Date.now()}`,
          link_token: `old_token_${Date.now()}`,
          email_normalized: "oldaff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `oldref${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Old Referred Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const existingCustomerId = `cus_existing_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: existingCustomerId },
      });

      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: {
          captured_at: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.organizationReferral.update({
        where: { organization_id: orgId },
        data: {
          first_seen_at: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
        },
      });

      const userRef = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
        select: { captured_at: true, status: true, affiliate_id: true },
      });
      expect(userRef?.status).toBe("ACTIVE");
      expect(userRef?.affiliate_id).toBe(affiliate.id);
      expect(Date.now() - userRef!.captured_at.getTime()).toBeGreaterThan(90 * 24 * 60 * 60 * 1000);

      const createCallsBeforeCheckout = mockCustomersCreate.mock.calls.length;
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs).toBeTruthy();
      expect(capturedCheckoutArgs?.customer).toBe(existingCustomerId);
      expect(mockCustomersCreate.mock.calls.length).toBe(createCallsBeforeCheckout);
      expect(capturedCheckoutArgs?.line_items?.[0]?.price).toBe(STRIPE_PRICE_PRO_TEST);
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
    });
  });

  describe("Business plan checkout", () => {
    it("referred org gets tt_* metadata for Business plan", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_biz_${Date.now()}`,
          link_token: `biz_token_${Date.now()}`,
          email_normalized: "bizaff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `bizref${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Business Referred Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true },
      });
      expect(org?.stripe_customer_id).toBeTruthy();

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
        select: { affiliate_id: true, status: true },
      });
      expect(orgRef?.status).toBe("ACTIVE");
      expect(orgRef?.affiliate_id).toBe(affiliate.id);

      const createCallsBeforeCheckout = mockCustomersCreate.mock.calls.length;
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "BUSINESS" },
      });

      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs).toBeTruthy();
      expect(capturedCheckoutArgs?.customer).toBe(org?.stripe_customer_id);
      expect(mockCustomersCreate.mock.calls.length).toBe(createCallsBeforeCheckout);
      expect(capturedCheckoutArgs?.line_items?.[0]?.price).toBe(STRIPE_PRICE_BUSINESS_TEST);
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
    });

    it("non-referred Business checkout has args equal to develop", async () => {
      const flagOnReg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `nonrefbiz${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      expect(flagOnReg.statusCode).toBe(201);
      const { user: onUser, sessionId: onSession } = JSON.parse(flagOnReg.body);
      testUserIds.push(onUser.id);

      const onOrgResp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${onSession}` },
        payload: { name: "Non-Referred Business Org" },
      });
      expect(onOrgResp.statusCode).toBe(201);
      const { id: onOrgId } = JSON.parse(onOrgResp.body);
      testOrgIds.push(onOrgId);

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: onOrgId },
      });
      expect(orgRef).toBeNull();

      const onCheckout = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${onOrgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${onSession}` },
        payload: { planTier: "BUSINESS" },
      });
      expect(onCheckout.statusCode).toBe(200);
      const flagOnArgs = capturedCheckoutArgs;
      expect(flagOnArgs).toBeTruthy();

      delete process.env.AFFILIATES_ENABLED;
      try {
        const flagOffReg = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: `flagoffbiz${Date.now()}@example.com`,
            password: "Password123!",
          },
        });
        expect(flagOffReg.statusCode).toBe(201);
        const { user: offUser, sessionId: offSession } = JSON.parse(flagOffReg.body);
        testUserIds.push(offUser.id);

        const offOrgResp = await app.inject({
          method: "POST",
          url: "/api/meta/organizations",
          headers: { cookie: `telemetry_session=${offSession}` },
          payload: { name: "Flag Off Business Org" },
        });
        expect(offOrgResp.statusCode).toBe(201);
        const { id: offOrgId } = JSON.parse(offOrgResp.body);
        testOrgIds.push(offOrgId);

        capturedCheckoutArgs = null;
        const offCheckout = await app.inject({
          method: "POST",
          url: `/api/meta/organizations/${offOrgId}/billing/checkout`,
          headers: { cookie: `telemetry_session=${offSession}` },
          payload: { planTier: "BUSINESS" },
        });
        expect(offCheckout.statusCode).toBe(200);
        expect(capturedCheckoutArgs).toBeTruthy();

        expect(normalizeCheckoutArgs(flagOnArgs!, onOrgId)).toEqual(
          normalizeCheckoutArgs(capturedCheckoutArgs!, offOrgId)
        );
        expect(flagOnArgs?.allow_promotion_codes).toBeUndefined();
        expect(flagOnArgs?.metadata?.tt_org_id).toBeUndefined();
        expect(flagOnArgs?.metadata?.tt_affiliate_id).toBeUndefined();
        expect(flagOnArgs?.line_items?.[0]?.price).toBe(STRIPE_PRICE_BUSINESS_TEST);
      } finally {
        process.env.AFFILIATES_ENABLED = "true";
      }
    });
  });

  describe("Commission webhook handling", () => {
    it("commission.created then commission.voided updates commission row", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_comm_${Date.now()}`,
          email_normalized: "commaff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const commissionId = `com_${Date.now()}`;
      const chargeId = `ch_${Date.now()}`;
      testCommissionIds.push(commissionId);
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // commission.created
      const createdEventId = `evt_comm_created_${Date.now()}`;
      testWebhookEventKeys.push(createdEventId);
      const createdPayload = {
        event: {
          id: createdEventId,
          type: "commission.created",
        },
        object: {
          id: commissionId,
          amount: 5000,
          currency: "usd",
          state: "due",
          due_at: dueDate.toISOString(),
          paid_at: null,
          voided_at: null,
          sale: {
            id: `sale_${Date.now()}`,
            stripe_charge_id: chargeId,
            affiliate: { id: affiliate.rewardful_affiliate_id },
          },
          affiliate: { id: affiliate.rewardful_affiliate_id },
        },
      };

      const createdSig = crypto
        .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
        .update(JSON.stringify(createdPayload))
        .digest("hex");

      const createResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": createdSig,
          "content-type": "application/json",
        },
        payload: createdPayload,
      });
      expect(createResp.statusCode).toBe(200);

      // Verify commission created
      const commission = await prisma.affiliateCommission.findFirst({
        where: { rewardful_commission_id: commissionId },
      });
      expect(commission).toBeTruthy();
      expect(commission?.amount_cents).toBe(5000);
      expect(commission?.currency).toBe("usd");
      expect(commission?.state).toBe("due");
      expect(commission?.stripe_charge_id).toBe(chargeId);
      expect(commission?.due_at).toEqual(dueDate);
      expect(commission?.paid_at).toBeNull();
      expect(commission?.voided_at).toBeNull();

      // commission.voided
      const voidedAt = new Date();
      const voidedEventId = `evt_comm_voided_${Date.now()}`;
      testWebhookEventKeys.push(voidedEventId);
      const voidedPayload = {
        event: {
          id: voidedEventId,
          type: "commission.voided",
        },
        object: {
          id: commissionId,
          amount: 5000,
          currency: "usd",
          state: "voided",
          due_at: dueDate.toISOString(),
          paid_at: null,
          voided_at: voidedAt.toISOString(),
          sale: {
            id: `sale_${Date.now()}`,
            stripe_charge_id: chargeId,
            affiliate: { id: affiliate.rewardful_affiliate_id },
          },
          affiliate: { id: affiliate.rewardful_affiliate_id },
        },
      };

      const voidedSig = crypto
        .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
        .update(JSON.stringify(voidedPayload))
        .digest("hex");

      const voidResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": voidedSig,
          "content-type": "application/json",
        },
        payload: voidedPayload,
      });
      expect(voidResp.statusCode).toBe(200);

      // Verify commission voided
      const voidedCommission = await prisma.affiliateCommission.findFirst({
        where: { rewardful_commission_id: commissionId },
      });
      expect(voidedCommission?.state).toBe("voided");
      expect(voidedCommission?.voided_at).toBeTruthy();
      expect(voidedCommission?.stripe_charge_id).toBe(chargeId);

      // Post the same voided payload again - should be idempotent
      const voidResp2 = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": voidedSig,
          "content-type": "application/json",
        },
        payload: voidedPayload,
      });
      expect(voidResp2.statusCode).toBe(200);

      // Verify only one commission row exists (not duplicated)
      const commissions = await prisma.affiliateCommission.findMany({
        where: { rewardful_commission_id: commissionId },
      });
      expect(commissions.length).toBe(1);
      expect(commissions[0].state).toBe("voided");
    });
  });

  describe("Rewardful referral.converted", () => {
    it("completes UUID-only referral and links org; affiliate_id comes from webhook not UUID", async () => {
      // Create affiliate with DISTINCT ids
      const affiliateId = `aff_webhook_${Date.now()}`;
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: affiliateId, // Affiliate's ID
          email_normalized: "webhookaffiliate@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Create a DISTINCT referral UUID (not the affiliate id)
      const referralUuid = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`;

      // Register with UUID only (no via token)
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `uuidonly${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Verify UserReferral created with status UNRESOLVED (UUID cannot resolve locally)
      const userRef = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(userRef).toBeTruthy();
      expect(userRef?.affiliate_id).toBeNull(); // No local resolution
      expect(userRef?.rewardful_referral_id).toBe(referralUuid);
      expect(userRef?.status).toBe("UNRESOLVED");

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "UUID Only Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      // Org should have referral with status UNRESOLVED
      const orgRefBefore = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRefBefore).toBeTruthy();
      expect(orgRefBefore?.affiliate_id).toBeNull();
      expect(orgRefBefore?.status).toBe("UNRESOLVED");
      expect(orgRefBefore?.rewardful_referral_id).toBe(referralUuid);

      // Send referral.converted webhook mapping the referral UUID to the affiliate
      const convertedEventId = `evt_uuid_converted_${Date.now()}`;
      testWebhookEventKeys.push(convertedEventId);
      const payload = {
        event: {
          id: convertedEventId,
          type: "referral.converted",
        },
        object: {
          id: referralUuid, // Referral UUID
          conversion_state: "converted",
          stripe_customer_id: `cus_uuid_${Date.now()}`,
          affiliate: {
            id: affiliateId, // Affiliate ID (distinct from referral UUID)
            email: "webhookaffiliate@example.com",
            token: "webhook_token",
          },
        },
      };

      const signature = crypto
        .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
        .update(JSON.stringify(payload))
        .digest("hex");

      const webhookResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signature,
          "content-type": "application/json",
        },
        payload,
      });
      expect(webhookResp.statusCode).toBe(200);

      // Verify UserReferral now has affiliate_id and status ACTIVE
      const updatedUserRef = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(updatedUserRef?.affiliate_id).toBe(affiliate.id); // Resolved via webhook
      expect(updatedUserRef?.rewardful_referral_id).toBe(referralUuid); // Still the referral UUID
      expect(updatedUserRef?.status).toBe("ACTIVE");

      // Verify OrganizationReferral now has affiliate_id and status ACTIVE
      const orgRefAfter = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRefAfter?.affiliate_id).toBe(affiliate.id);
      expect(orgRefAfter?.status).toBe("ACTIVE");
      expect(orgRefAfter?.needs_attention).toBe(false);

      // Org was UNRESOLVED without a payout hold, so Customer already has metadata.referral.

      // Send a second referral.converted for a DIFFERENT affiliate
      const affiliate2 = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_different_${Date.now()}`,
          email_normalized: "different@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate2.id);

      const differentEventId = `evt_different_${Date.now()}`;
      testWebhookEventKeys.push(differentEventId);
      const payload2 = {
        event: {
          id: differentEventId,
          type: "referral.converted",
        },
        object: {
          id: referralUuid, // Same referral UUID
          conversion_state: "converted",
          stripe_customer_id: `cus_different_${Date.now()}`,
          affiliate: {
            id: affiliate2.rewardful_affiliate_id,
            email: "different@example.com",
          },
        },
      };

      const signature2 = crypto
        .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
        .update(JSON.stringify(payload2))
        .digest("hex");

      const webhookResp2 = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signature2,
          "content-type": "application/json",
        },
        payload: payload2,
      });
      expect(webhookResp2.statusCode).toBe(200);

      // Verify attribution did NOT change (locked to first affiliate)
      const finalUserRef = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(finalUserRef?.affiliate_id).toBe(affiliate.id); // Still first affiliate

      const finalOrgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(finalOrgRef?.affiliate_id).toBe(affiliate.id); // Still first affiliate
      expect(finalOrgRef?.needs_attention).toBe(false); // No change - webhook was no-op
      
      // The completeUnresolvedReferrals function only processes referrals with affiliate_id: null
      // So once a referral is attributed, subsequent webhooks for different affiliates are ignored
    });
  });

  describe("First-org-only attribution", () => {
    it("referred user creates 3 orgs, only first attributed", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_3org_${Date.now()}`,
          link_token: `token_3org_${Date.now()}`,
          email_normalized: "aff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register with referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `threeorgs${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create first org
      const org1Resp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "First Org" },
      });
      const { id: org1Id } = JSON.parse(org1Resp.body);
      testOrgIds.push(org1Id);

      // Archive first org
      await prisma.organization.update({
        where: { id: org1Id },
        data: { deleted_at: new Date() },
      });

      // Create second org
      const org2Resp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Second Org" },
      });
      const { id: org2Id } = JSON.parse(org2Resp.body);
      testOrgIds.push(org2Id);

      // Create third org
      const org3Resp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Third Org" },
      });
      const { id: org3Id } = JSON.parse(org3Resp.body);
      testOrgIds.push(org3Id);

      // Verify only first org has referral
      const ref1 = await prisma.organizationReferral.findUnique({
        where: { organization_id: org1Id },
      });
      expect(ref1).toBeTruthy();
      expect(ref1?.affiliate_id).toBe(affiliate.id);

      const ref2 = await prisma.organizationReferral.findUnique({
        where: { organization_id: org2Id },
      });
      expect(ref2).toBeNull();

      const ref3 = await prisma.organizationReferral.findUnique({
        where: { organization_id: org3Id },
      });
      expect(ref3).toBeNull();

      // Verify UserReferral attributed_organization_id is first org
      const userRef = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(userRef?.attributed_organization_id).toBe(org1Id);
    });

    it("UUID-only first-org-only: customers.create once with metadata.referral", async () => {
      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `uuid3orgs${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      mockCustomersCreate.mockClear();

      const org1Resp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "UUID First Org" },
      });
      const { id: org1Id } = JSON.parse(org1Resp.body);
      testOrgIds.push(org1Id);

      await prisma.organization.update({
        where: { id: org1Id },
        data: { deleted_at: new Date() },
      });

      const org2Resp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "UUID Second Org" },
      });
      const { id: org2Id } = JSON.parse(org2Resp.body);
      testOrgIds.push(org2Id);

      const org3Resp = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "UUID Third Org" },
      });
      const { id: org3Id } = JSON.parse(org3Resp.body);
      testOrgIds.push(org3Id);

      expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.organization_id).toBe(org1Id);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.referral).toBe(referralUuid);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.tt_affiliate_id).toBeUndefined();

      const firstOrgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: org1Id },
      });
      expect(firstOrgRef?.status).toBe("UNRESOLVED");
      expect(firstOrgRef?.needs_attention).toBe(false);

      expect(
        await prisma.organizationReferral.findUnique({ where: { organization_id: org1Id } })
      ).toBeTruthy();
      expect(
        await prisma.organizationReferral.findUnique({ where: { organization_id: org2Id } })
      ).toBeNull();
      expect(
        await prisma.organizationReferral.findUnique({ where: { organization_id: org3Id } })
      ).toBeNull();
    });
  });

  describe("Tamper: UUID looks like affiliate A, via token is B", () => {
    it("attributes to B never A; Customer metadata.referral is X and tt_affiliate_id is B", async () => {
      const affiliateAId = uniqueReferralUuid();
      const affiliateA = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: affiliateAId,
          email_normalized: "affiliate-a@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliateA.id);

      const viaToken = `token_b_${Date.now()}`;
      const affiliateB = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_b_${Date.now()}`,
          link_token: viaToken,
          email_normalized: "affiliate-b@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliateB.id);

      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `tamperreal${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: affiliateAId,
          viaToken,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const userReferral = await prisma.userReferral.findUnique({
        where: { user_id: user.id },
      });
      expect(userReferral?.affiliate_id).toBe(affiliateB.id);
      expect(userReferral?.affiliate_id).not.toBe(affiliateA.id);
      expect(userReferral?.rewardful_referral_id).toBe(affiliateAId);

      mockCustomersCreate.mockClear();
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Tamper Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral?.affiliate_id).toBe(affiliateB.id);
      expect(orgReferral?.affiliate_id).not.toBe(affiliateA.id);
      expect(orgReferral?.rewardful_referral_id).toBe(affiliateAId);

      expect(mockCustomersCreate).toHaveBeenCalled();
      expect(mockCustomersCreate.mock.calls[0][0].metadata.referral).toBe(affiliateAId);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.tt_affiliate_id).toBe(affiliateB.id);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true },
      });
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.customer).toBe(org?.stripe_customer_id);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliateB.id);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
    });
  });

  describe("Webhook timing vs expiry decided at org creation", () => {
    it("on-time org + day-70 referral.converted becomes ACTIVE and gets tt_* at checkout", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_late_ok_${Date.now()}`,
          email_normalized: "lateok@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `lateok${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "On Time Then Late Convert Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const seventyDaysAgo = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { captured_at: seventyDaysAgo },
      });
      await prisma.organizationReferral.update({
        where: { organization_id: orgId },
        data: { first_seen_at: seventyDaysAgo },
      });

      const eventId = `evt_late_ok_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: { id: eventId, type: "referral.converted" },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: {
            id: affiliate.rewardful_affiliate_id,
            email: "lateok@example.com",
          },
        },
      };
      const webhookResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(payload),
          "content-type": "application/json",
        },
        payload,
      });
      expect(webhookResp.statusCode).toBe(200);

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef?.status).toBe("ACTIVE");
      expect(orgRef?.affiliate_id).toBe(affiliate.id);

      const existingCustomerId = `cus_late_ok_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: existingCustomerId },
      });

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
    });

    it("org created after expiry then converted stays EXPIRED and gets no tt_* at checkout", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_late_exp_${Date.now()}`,
          email_normalized: "lateexp@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `lateexp${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { captured_at: referralCapturedAtDaysAgo(REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1) },
      });

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Already Expired Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const before = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(before?.status).toBe("EXPIRED");

      const eventId = `evt_late_exp_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: { id: eventId, type: "referral.converted" },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: {
            id: affiliate.rewardful_affiliate_id,
            email: "lateexp@example.com",
          },
        },
      };
      const webhookResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(payload),
          "content-type": "application/json",
        },
        payload,
      });
      expect(webhookResp.statusCode).toBe(200);

      const after = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(after?.status).toBe("EXPIRED");
      expect(after?.affiliate_id).toBeNull();

      const existingCustomerId = `cus_late_exp_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: existingCustomerId },
      });
      mockCustomersUpdate.mockClear();

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.customer).toBe(existingCustomerId);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBeUndefined();
      expect(mockCustomersUpdate).not.toHaveBeenCalled();
    });
  });

  describe("payout hold vs unresolved / Stripe failure", () => {
    it("plain UUID-only: customers.create has metadata.referral and needs_attention is false", async () => {
      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `uuid-plain-${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      mockCustomersCreate.mockClear();
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Plain UUID Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral?.status).toBe("UNRESOLVED");
      expect(orgReferral?.needs_attention).toBe(false);
      expect(orgReferral?.attention_reason).toBeNull();
      expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.referral).toBe(referralUuid);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.tt_affiliate_id).toBeUndefined();
    });

    it("no-email affiliate at org create is a payout hold with no metadata.referral", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_noemail_payout_${Date.now()}`,
          email_normalized: null,
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `noemail-payout-${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const eventId = `evt_noemail_before_org_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const convertPayload = {
        event: { id: eventId, type: "referral.converted" },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: { id: affiliate.rewardful_affiliate_id },
        },
      };
      const webhookResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(convertPayload),
          "content-type": "application/json",
        },
        payload: convertPayload,
      });
      expect(webhookResp.statusCode).toBe(200);

      mockCustomersCreate.mockClear();
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "No Email Payout Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral?.status).toBe("ACTIVE");
      expect(orgReferral?.needs_attention).toBe(true);
      expect(orgReferral?.attention_reason).toBe("affiliate_email_unknown");
      expect(orgReferral?.affiliate_id).toBe(affiliate.id);

      expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
      const createdMetadata = mockCustomersCreate.mock.calls[0][0].metadata;
      expect(createdMetadata.organization_id).toBe(orgId);
      expect(createdMetadata.referral).toBeUndefined();
      expect(createdMetadata.tt_affiliate_id).toBeUndefined();

      mockCustomersUpdate.mockClear();
      mockCustomersCreate.mockClear();
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBeUndefined();
      expect(mockCustomersUpdate).not.toHaveBeenCalled();
    });

    it("customer_creation_failed then checkout backfills referral onto the checkout Customer", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_createfail_${Date.now()}`,
          link_token: `createfail_${Date.now()}`,
          email_normalized: "createfail@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `createfail-${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      mockCustomersCreate.mockRejectedValueOnce(new Error("stripe customers.create failed"));
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Create Fail Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral?.attention_reason).toContain("customer_creation_failed");
      expect(orgReferral?.status).toBe("ACTIVE");
      expect(orgReferral?.affiliate_id).toBe(affiliate.id);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true },
      });
      expect(org?.stripe_customer_id).toBeNull();

      mockCustomersCreate.mockClear();
      mockCustomersUpdate.mockClear();
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.organization_id).toBe(orgId);
      expect(mockCustomersUpdate).toHaveBeenCalledTimes(1);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.referral).toBe(referralUuid);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.tt_affiliate_id).toBe(affiliate.id);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
    });

    it("after conversion clears payout hold, checkout backfills metadata.referral and tt_*", async () => {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_cleared_payout_${Date.now()}`,
          link_token: `cleared_payout_${Date.now()}`,
          email_normalized: null,
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `cleared-payout-${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: affiliate.link_token,
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Cleared Payout Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const before = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(before?.status).toBe("UNRESOLVED");
      expect(before?.needs_attention).toBe(false);
      expect(mockCustomersCreate.mock.calls[0][0].metadata.referral).toBe(referralUuid);

      await prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { email_normalized: "cleared-affiliate@example.com" },
      });

      const eventId = `evt_cleared_payout_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: { id: eventId, type: "referral.converted" },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: {
            id: affiliate.rewardful_affiliate_id,
            email: "cleared-affiliate@example.com",
          },
        },
      };
      const webhookResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(payload),
          "content-type": "application/json",
        },
        payload,
      });
      expect(webhookResp.statusCode).toBe(200);

      const after = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(after?.status).toBe("ACTIVE");
      expect(after?.affiliate_id).toBe(affiliate.id);
      expect(after?.needs_attention).toBe(false);

      mockCustomersUpdate.mockClear();
      mockCustomersCreate.mockClear();
      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBe(orgId);
      expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBe(affiliate.id);
      expect(mockCustomersCreate).not.toHaveBeenCalled();
      expect(mockCustomersUpdate).toHaveBeenCalledTimes(1);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.referral).toBe(referralUuid);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.tt_affiliate_id).toBe(affiliate.id);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.tt_org_id).toBe(orgId);
    });
  });

  describe("POST resolve-needs-attention", () => {
    const resolvePath = (orgId: string) =>
      `/api/meta/affiliates/organizations/${orgId}/resolve-needs-attention`;
    let adminEmailsSnap: string | undefined;

    beforeEach(() => {
      adminEmailsSnap = process.env.AFFILIATE_ADMIN_EMAILS;
    });

    afterEach(() => {
      if (adminEmailsSnap === undefined) delete process.env.AFFILIATE_ADMIN_EMAILS;
      else process.env.AFFILIATE_ADMIN_EMAILS = adminEmailsSnap;
    });

    it("returns 401 without an admin session", async () => {
      const response = await app.inject({
        method: "POST",
        url: resolvePath("00000000-0000-4000-8000-000000000099"),
        payload: { reason: "No session" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns 403 when the session email is not allowlisted", async () => {
      const email = `not-admin-resolve-${Date.now()}@example.com`;
      process.env.AFFILIATE_ADMIN_EMAILS = "founder-only@example.com";
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "Password123!" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { user: { id: string }; sessionId: string };
      testUserIds.push(body.user.id);

      const response = await app.inject({
        method: "POST",
        url: resolvePath("00000000-0000-4000-8000-000000000099"),
        headers: { cookie: `telemetry_session=${body.sessionId}` },
        payload: { reason: "Not allowlisted" },
      });
      expect(response.statusCode).toBe(403);
    });

    async function registerAdmin() {
      const email = `founder-resolve-${Date.now()}@example.com`;
      process.env.AFFILIATE_ADMIN_EMAILS = email;
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "Password123!" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { user: { id: string }; sessionId: string };
      testUserIds.push(body.user.id);
      return { email, sessionId: body.sessionId, userId: body.user.id };
    }

    async function createActiveNeedsAttentionOrg() {
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_resolve_${Date.now()}`,
          email_normalized: null,
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      const referralUuid = uniqueReferralUuid();
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `resolve-user-${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: referralUuid,
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Convert before org create so attribution sees a known affiliate with no email
      // (payout hold) and withholds metadata.referral.
      const eventId = `evt_resolve_${Date.now()}`;
      testWebhookEventKeys.push(eventId);
      const payload = {
        event: { id: eventId, type: "referral.converted" },
        object: {
          id: referralUuid,
          conversion_state: "converted",
          affiliate: { id: affiliate.rewardful_affiliate_id },
        },
      };
      const webhookResp = await app.inject({
        method: "POST",
        url: "/webhooks/rewardful",
        headers: {
          "x-rewardful-signature": signRewardfulPayload(payload),
          "content-type": "application/json",
        },
        payload,
      });
      expect(webhookResp.statusCode).toBe(200);

      mockCustomersCreate.mockClear();
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Resolve Attention Org" },
      });
      expect(orgResponse.statusCode).toBe(201);
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true },
      });
      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef?.status).toBe("ACTIVE");
      expect(orgRef?.needs_attention).toBe(true);
      expect(orgRef?.affiliate_id).toBe(affiliate.id);

      return {
        orgId,
        affiliate,
        referralUuid,
        customerId: org?.stripe_customer_id ?? null,
        sessionId,
      };
    }

    it("resolve as valid adds referral metadata to the existing Customer", async () => {
      const { orgId, affiliate, referralUuid, customerId } =
        await createActiveNeedsAttentionOrg();
      expect(customerId).toBeTruthy();
      expect(mockCustomersCreate.mock.calls[0][0].metadata.referral).toBeUndefined();

      const admin = await registerAdmin();
      mockCustomersCreate.mockClear();
      mockCustomersUpdate.mockClear();

      const response = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "Verified affiliate email with founder" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resolved).toBe(true);
      expect(body.idempotent).toBe(false);
      expect(body.toStatus).toBe("ACTIVE");
      expect(body.needsAttention).toBe(false);
      expect(body.customerId).toBe(customerId);
      expect(body.stripe).toBe("updated");
      expect(body.affiliateId).toBe(affiliate.id);

      expect(mockCustomersCreate).not.toHaveBeenCalled();
      expect(mockCustomersUpdate).toHaveBeenCalledTimes(1);
      expect(mockCustomersUpdate.mock.calls[0][0]).toBe(customerId);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.referral).toBe(referralUuid);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.tt_affiliate_id).toBe(affiliate.id);

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef?.needs_attention).toBe(false);
      expect(orgRef?.affiliate_id).toBe(affiliate.id);
      expect(orgRef?.status).toBe("ACTIVE");

      const audit = await prisma.organizationAuditEvent.findFirst({
        where: { organization_id: orgId, action: AFFILIATE_RESOLVE_AUDIT_ACTION },
      });
      expect(audit?.actor_email).toBe(admin.email);
      expect(audit?.actor_user_id).toBe(admin.userId);
      expect(audit?.target).toContain("from=ACTIVE+needs_attention=true");
      expect(audit?.target).toContain("to=ACTIVE+needs_attention=false");
      expect(audit?.target).toContain("Verified affiliate email with founder");
    });

    it("resolution does not call customers.create", async () => {
      const { orgId, customerId } = await createActiveNeedsAttentionOrg();
      const admin = await registerAdmin();
      mockCustomersCreate.mockClear();

      const response = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "Attach to existing customer only" },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).customerId).toBe(customerId);
      expect(mockCustomersCreate).not.toHaveBeenCalled();
    });

    it("resolution cannot change canonical affiliate", async () => {
      const { orgId, affiliate } = await createActiveNeedsAttentionOrg();
      const other = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: `aff_other_resolve_${Date.now()}`,
          email_normalized: "other-resolve@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(other.id);

      const admin = await registerAdmin();
      mockCustomersUpdate.mockClear();
      mockCustomersCreate.mockClear();

      const response = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: {
          reason: "Try to reassign",
          affiliateId: other.id,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).code).toBe("affiliate_mismatch");
      expect(mockCustomersUpdate).not.toHaveBeenCalled();
      expect(mockCustomersCreate).not.toHaveBeenCalled();

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef?.affiliate_id).toBe(affiliate.id);
      expect(orgRef?.needs_attention).toBe(true);
    });

    it("duplicate resolution is idempotent", async () => {
      const { orgId, customerId, referralUuid, affiliate } =
        await createActiveNeedsAttentionOrg();
      const admin = await registerAdmin();

      const first = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "First resolve" },
      });
      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body).idempotent).toBe(false);

      mockCustomersUpdate.mockClear();
      mockCustomersCreate.mockClear();
      mockCustomersRetrieve.mockImplementation(async (id: string) => ({
        id,
        deleted: false,
        metadata: {
          referral: referralUuid,
          tt_affiliate_id: affiliate.id,
          tt_org_id: orgId,
        },
      }));

      const second = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "Second resolve" },
      });
      expect(second.statusCode).toBe(200);
      const body = JSON.parse(second.body);
      expect(body.idempotent).toBe(true);
      expect(body.customerId).toBe(customerId);
      expect(body.toStatus).toBe("ACTIVE");
      expect(body.needsAttention).toBe(false);
      expect(body.affiliateId).toBe(affiliate.id);
      expect(mockCustomersCreate).not.toHaveBeenCalled();
      expect(mockCustomersUpdate).not.toHaveBeenCalled();

      const audits = await prisma.organizationAuditEvent.findMany({
        where: { organization_id: orgId, action: AFFILIATE_RESOLVE_AUDIT_ACTION },
      });
      expect(audits).toHaveLength(1);
    });

    it("rejected referral never gets Rewardful metadata", async () => {
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `rejected-resolve-${Date.now()}@example.com`,
          password: "Password123!",
        },
      });
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Rejected Resolve Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const referralUuid = uniqueReferralUuid();
      await prisma.organizationReferral.create({
        data: {
          organization_id: orgId,
          affiliate_id: null,
          rewardful_referral_id: referralUuid,
          source: "link",
          status: "REJECTED",
          needs_attention: true,
          attention_reason: "rejected_self_referral",
        },
      });
      const existingCustomerId = `cus_rejected_resolve_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: existingCustomerId },
      });

      const admin = await registerAdmin();
      mockCustomersUpdate.mockClear();
      mockCustomersCreate.mockClear();

      const response = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "Should not resolve rejected" },
      });
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).code).toBe("rejected");
      expect(mockCustomersUpdate).not.toHaveBeenCalled();
      expect(mockCustomersCreate).not.toHaveBeenCalled();

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef?.status).toBe("REJECTED");
      expect(orgRef?.needs_attention).toBe(true);
      expect(
        await prisma.organizationAuditEvent.findFirst({
          where: { organization_id: orgId, action: AFFILIATE_RESOLVE_AUDIT_ACTION },
        })
      ).toBeNull();
    });

    it("resolve without stripe_customer_id clears flag and defers metadata to checkout backfill", async () => {
      const { orgId, affiliate, referralUuid, sessionId } =
        await createActiveNeedsAttentionOrg();
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripe_customer_id: null },
      });

      const admin = await registerAdmin();
      mockCustomersCreate.mockClear();
      mockCustomersUpdate.mockClear();

      const response = await app.inject({
        method: "POST",
        url: resolvePath(orgId),
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "No customer yet; backfill on checkout" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.stripe).toBe("deferred");
      expect(body.customerId).toBeNull();
      expect(body.needsAttention).toBe(false);
      expect(mockCustomersCreate).not.toHaveBeenCalled();
      expect(mockCustomersUpdate).not.toHaveBeenCalled();

      const orgRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgRef?.needs_attention).toBe(false);
      expect(orgRef?.status).toBe("ACTIVE");
      expect(orgRef?.affiliate_id).toBe(affiliate.id);

      const audit = await prisma.organizationAuditEvent.findFirst({
        where: { organization_id: orgId, action: AFFILIATE_RESOLVE_AUDIT_ACTION },
      });
      expect(audit?.target).toContain("stripe=deferred");
      expect(audit?.target).toContain("customer=none");

      const checkoutResponse = await app.inject({
        method: "POST",
        url: `/api/meta/organizations/${orgId}/billing/checkout`,
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { planTier: "PRO" },
      });
      expect(checkoutResponse.statusCode).toBe(200);
      expect(mockCustomersUpdate).toHaveBeenCalled();
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.referral).toBe(referralUuid);
      expect(mockCustomersUpdate.mock.calls[0][1].metadata.tt_affiliate_id).toBe(
        affiliate.id
      );
    });
  });
});
