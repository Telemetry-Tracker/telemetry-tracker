/**
 * Affiliate program integration tests
 * Run with: RUN_DB_INTEGRATION_TESTS=true pnpm test affiliates.integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import crypto from "node:crypto";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

testSuite("Affiliate Integration Tests", () => {
  let app: FastifyInstance;
  let testUserIds: string[] = [];
  let testOrgIds: string[] = [];
  let testAffiliateIds: string[] = [];

  beforeAll(async () => {
    process.env.AFFILIATES_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.REWARDFUL_WEBHOOK_SECRET = "whsec_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_stripe_mock";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AFFILIATES_ENABLED;
  });

  beforeEach(async () => {
    // Clean up test data from previous test
    if (testOrgIds.length > 0) {
      await prisma.organizationReferral.deleteMany({
        where: { organization_id: { in: testOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: testOrgIds } },
      });
      testOrgIds = [];
    }
    if (testUserIds.length > 0) {
      await prisma.userReferral.deleteMany({
        where: { user_id: { in: testUserIds } },
      });
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
  });

  describe("Organization Attribution", () => {
    it("attributes first org as OWNER", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: "aff_first_org",
          link_token: "firstorg",
          email_normalized: "aff@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register user with referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: `firstorg${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: "firstorg",
        },
      });
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `tt-session=${sessionId}` },
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
          rewardful_affiliate_id: "aff_second_org",
          link_token: "secondorg",
          email_normalized: "aff2@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register user with referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: `secondorg${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: "secondorg",
        },
      });
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Create first org
      const org1Response = await app.inject({
        method: "POST",
        url: "/meta/organizations",
        headers: { cookie: `tt-session=${sessionId}` },
        payload: { name: "First Org" },
      });
      const { id: org1Id } = JSON.parse(org1Response.body);
      testOrgIds.push(org1Id);

      // Create second org
      const org2Response = await app.inject({
        method: "POST",
        url: "/meta/organizations",
        headers: { cookie: `tt-session=${sessionId}` },
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

    it("handles 55-day expiry", async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          rewardful_affiliate_id: "aff_expired",
          link_token: "expiredtoken",
          email_normalized: "expired@example.com",
          state: "active",
        },
      });
      testAffiliateIds.push(affiliate.id);

      // Register user
      const regResponse = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: `expired${Date.now()}@example.com`,
          password: "Password123!",
          viaToken: "expiredtoken",
        },
      });
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Manually update captured_at to 56 days ago
      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { captured_at: new Date(Date.now() - 56 * 24 * 60 * 60 * 1000) },
      });

      // Create org
      const orgResponse = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `tt-session=${sessionId}` },
        payload: { name: "Expired Org" },
      });
      const { id: orgId } = JSON.parse(orgResponse.body);
      testOrgIds.push(orgId);

      const orgReferral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(orgReferral).toBeTruthy();
      expect(orgReferral?.needs_attention).toBe(true);
      expect(orgReferral?.attention_reason).toContain("expired");
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

    it("returns 404 for Rewardful webhook when flag is OFF", async () => {
      const response = await flagOffApp.inject({
        method: "POST",
        url: "/api/webhooks/rewardful",
        headers: { "x-rewardful-signature": "0".repeat(64) },
        payload: { event: { id: "evt_test", type: "test" }, object: {} },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // Webhook deduplication is tested in webhook-dedupe.test.ts at the unit level
  // Route-level integration testing of Stripe webhooks would require mocking Stripe SDK

  describe("Organization Attribution Error Handling", () => {
    it("creates org successfully even if attribution fails", async () => {
      // Register user with referral
      const regResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `attrerr${Date.now()}@example.com`,
          password: "Password123!",
          rewardfulReferralId: "00000000-0000-4000-8000-999999999999", // Non-existent
        },
      });
      expect(regResponse.statusCode).toBe(201);
      const { user, sessionId } = JSON.parse(regResponse.body);
      testUserIds.push(user.id);

      // Force attribution failure by corrupting Stripe env temporarily
      const originalKey = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = "sk_test_invalid_will_cause_error";

      try {
        // Create org - should succeed despite attribution failure
        const orgResponse = await app.inject({
          method: "POST",
          url: "/api/meta/organizations",
          headers: { cookie: `tt-session=${sessionId}` },
          payload: { name: "Attribution Error Test Org" },
        });

        // Assert org created successfully
        expect(orgResponse.statusCode).toBe(201);
        const { id: orgId } = JSON.parse(orgResponse.body);
        testOrgIds.push(orgId);

        // Verify org exists in database
        const org = await prisma.organization.findUnique({
          where: { id: orgId },
        });
        expect(org).not.toBeNull();
        expect(org?.name).toBe("Attribution Error Test Org");
      } finally {
        // Restore original key
        process.env.STRIPE_SECRET_KEY = originalKey;
      }
    });
  });
});
