import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../lib/db.js";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import type Stripe from "stripe";
import {
  applyAffiliateTestEnv,
  cleanupAffiliateFixtures,
  referralCapturedAtDaysAgo,
  REFERRAL_ATTRIBUTION_WINDOW_DAYS,
  restoreEnv,
  signRewardfulPayload,
  signStripeEvent,
  snapshotEnv,
  uniqueReferralUuid,
} from "./affiliate-test-helpers.js";

const RUN_DB_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === "true";

let capturedCheckoutArgs: Stripe.Checkout.SessionCreateParams | null = null;
let mockCheckoutSessionsCreate: ReturnType<typeof vi.fn>;
let mockCustomersCreate: ReturnType<typeof vi.fn>;
let mockCustomersRetrieve: ReturnType<typeof vi.fn>;
let mockCustomersUpdate: ReturnType<typeof vi.fn>;
let mockSubscriptionsRetrieve: ReturnType<typeof vi.fn>;
let mockChargesRetrieve: ReturnType<typeof vi.fn>;
const mockSendTransactionalEmail = vi.fn();

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

vi.mock("../lib/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email.js")>();
  return {
    ...actual,
    sendTransactionalEmail: (...args: unknown[]) => mockSendTransactionalEmail(...args),
  };
});

(RUN_DB_TESTS ? describe : describe.skip)("Affiliates protections (integration)", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdAffiliateIds: string[] = [];
  const createdReferralIds: string[] = [];
  const createdWebhookEventIds: string[] = [];
  const createdWebhookEventKeys: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    originalEnv = snapshotEnv();
    applyAffiliateTestEnv();
  });

  afterAll(async () => {
    await cleanupAffiliateFixtures(prisma, {
      userIds: createdUserIds,
      orgIds: createdOrgIds,
      affiliateIds: createdAffiliateIds,
      referralIds: createdReferralIds,
      webhookEventIds: createdWebhookEventIds,
      webhookEventKeys: createdWebhookEventKeys,
    });
    restoreEnv(originalEnv);
  });

  beforeEach(async () => {
    resetStripeMocks();
    mockSendTransactionalEmail.mockReset();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await cleanupAffiliateFixtures(prisma, {
      userIds: createdUserIds,
      orgIds: createdOrgIds,
      affiliateIds: createdAffiliateIds,
      referralIds: createdReferralIds,
      webhookEventIds: createdWebhookEventIds,
      webhookEventKeys: createdWebhookEventKeys,
    });
  });

  it("completeUnresolvedReferrals: expired referral stays expired after webhook", async () => {
    // Create user with expired referral (outside the 60-day window)
    const expiredDate = referralCapturedAtDaysAgo(REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1);
    const user = await prisma.user.create({
      data: {
        email: `expired-test-${Date.now()}@example.com`,
        password_hash: "dummy",
      },
    });
    createdUserIds.push(user.id);

    // Create affiliate
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_expired_${Date.now()}`,
        email_normalized: "affiliate@example.com",
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Create org with expired referral (affiliate_id null, first_seen_at outside 60-day window)
    const org = await prisma.organization.create({
      data: {
        name: "Expired Org",
        
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org.id);

    const referral = await prisma.organizationReferral.create({
      data: {
        organization_id: org.id,
        affiliate_id: null,
        rewardful_referral_id: `ref_expired_${Date.now()}`,
        source: "link",
        status: "EXPIRED",
        first_seen_at: expiredDate,
        needs_attention: false,
      },
    });
    createdReferralIds.push(referral.id);

    // Simulate Rewardful webhook (referral.converted)
    const expiredEventId = `evt_expired_${Date.now()}`;
    createdWebhookEventKeys.push(expiredEventId);
    const rewardfulPayload = {
      event: {
        id: expiredEventId,
        type: "referral.converted",
      },
      object: {
        id: referral.rewardful_referral_id,
        affiliate: { id: affiliate.rewardful_affiliate_id },
        state: "converted",
      },
    };

    const signature = crypto
      .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
      .update(JSON.stringify(rewardfulPayload))
      .digest("hex");

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/rewardful",
      headers: {
        "x-rewardful-signature": signature,
        "content-type": "application/json",
      },
      payload: rewardfulPayload,
    });

    expect(response.statusCode).toBe(200);

    // Check that expired referral was NOT completed
    const updatedReferral = await prisma.organizationReferral.findUnique({
      where: { id: referral.id },
      select: { affiliate_id: true, needs_attention: true, attention_reason: true },
    });

    expect(updatedReferral?.affiliate_id).toBeNull(); // Should remain null
    expect(updatedReferral?.needs_attention).toBe(false); // Should not have been modified
  });

  it("checkout: expired referral gives no tt_* or referral metadata", async () => {
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_exp_checkout_${Date.now()}`,
        link_token: `exp_token_${Date.now()}`,
        email_normalized: "affiliate2@example.com",
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    const regResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `exp-checkout-${Date.now()}@example.com`,
        password: "Password123!",
        viaToken: affiliate.link_token,
      },
    });
    expect(regResponse.statusCode).toBe(201);
    const { user, sessionId } = JSON.parse(regResponse.body);
    createdUserIds.push(user.id);

    await prisma.userReferral.update({
      where: { user_id: user.id },
      data: { captured_at: referralCapturedAtDaysAgo(REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1) },
    });

    const orgResponse = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name: "Expired Checkout Org" },
    });
    expect(orgResponse.statusCode).toBe(201);
    const { id: orgId } = JSON.parse(orgResponse.body);
    createdOrgIds.push(orgId);

    const orgRef = await prisma.organizationReferral.findUnique({
      where: { organization_id: orgId },
    });
    expect(orgRef?.status).toBe("EXPIRED");
    if (orgRef) createdReferralIds.push(orgRef.id);

    const existingCustomerId = `cus_expired_${Date.now()}`;
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

  it("checkout: REJECTED referral gives no tt_* or referral backfill", async () => {
    const email = `rej-checkout-${Date.now()}@example.com`;
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_rej_checkout_${Date.now()}`,
        email_normalized: email.toLowerCase(),
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    const referralUuid = uniqueReferralUuid();
    const regResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email,
        password: "Password123!",
        rewardfulReferralId: referralUuid,
      },
    });
    expect(regResponse.statusCode).toBe(201);
    const { user, sessionId } = JSON.parse(regResponse.body);
    createdUserIds.push(user.id);

    const orgResponse = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name: "Rejected Checkout Org" },
    });
    expect(orgResponse.statusCode).toBe(201);
    const { id: orgId } = JSON.parse(orgResponse.body);
    createdOrgIds.push(orgId);

    const eventId = `evt_rej_checkout_${Date.now()}`;
    createdWebhookEventKeys.push(eventId);
    const payload = {
      event: { id: eventId, type: "referral.converted" },
      object: {
        id: referralUuid,
        conversion_state: "converted",
        affiliate: { id: affiliate.rewardful_affiliate_id, email },
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
    expect(orgRef?.status).toBe("REJECTED");
    if (orgRef) createdReferralIds.push(orgRef.id);

    const existingCustomerId = `cus_rejected_${Date.now()}`;
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
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  it("checkout: ACTIVE with needs_attention (affiliate has no email) gets no tt_*", async () => {
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_noemail_${Date.now()}`,
        email_normalized: null,
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    const referralUuid = uniqueReferralUuid();
    const regResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `noemail-checkout-${Date.now()}@example.com`,
        password: "Password123!",
        rewardfulReferralId: referralUuid,
      },
    });
    expect(regResponse.statusCode).toBe(201);
    const { user, sessionId } = JSON.parse(regResponse.body);
    createdUserIds.push(user.id);

    const orgResponse = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name: "No Email Checkout Org" },
    });
    expect(orgResponse.statusCode).toBe(201);
    const { id: orgId } = JSON.parse(orgResponse.body);
    createdOrgIds.push(orgId);

    const eventId = `evt_noemail_checkout_${Date.now()}`;
    createdWebhookEventKeys.push(eventId);
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

    const orgRef = await prisma.organizationReferral.findUnique({
      where: { organization_id: orgId },
    });
    expect(orgRef?.status).toBe("ACTIVE");
    expect(orgRef?.needs_attention).toBe(true);
    expect(orgRef?.affiliate_id).toBe(affiliate.id);
    if (orgRef) createdReferralIds.push(orgRef.id);

    const existingCustomerId = `cus_noemail_${Date.now()}`;
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
    expect(capturedCheckoutArgs?.customer).toBe(existingCustomerId);
    expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
    expect(capturedCheckoutArgs?.metadata?.tt_affiliate_id).toBeUndefined();
    expect(capturedCheckoutArgs?.metadata?.organization_id).toBe(orgId);
  });

  it("dedupe claim_token: stale first owner can't mark reclaimer's row", async () => {
    // Use real webhook-dedupe functions instead of raw SQL
    const { dedupeWebhookEvent, markWebhookProcessed } = await import("../lib/webhook-dedupe.js");
    
    const eventId = `evt_claim_${Date.now()}`;
    
    // First delivery claims it
    const firstResult = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(firstResult.kind).toBe("first_delivery");
    
    if (firstResult.kind === "first_delivery") {
      createdWebhookEventIds.push(firstResult.id);
      
      // Make it stale by updating locked_at to 15 minutes ago
      await prisma.webhookEvent.update({
        where: { id: firstResult.id },
        data: { locked_at: new Date(Date.now() - 15 * 60 * 1000) },
      });
      
      // Second delivery reclaims it (stale threshold is 10 minutes)
      const reclaimResult = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
      expect(reclaimResult.kind).toBe("first_delivery");
      
      if (reclaimResult.kind === "first_delivery") {
        // Original owner tries to mark processed with old token (should fail silently)
        await markWebhookProcessed(prisma, firstResult.id, firstResult.claimToken);
        
        // Verify it's still processing (not marked by stale owner)
        const stillProcessing = await prisma.webhookEvent.findUnique({
          where: { id: firstResult.id },
          select: { status: true, claim_token: true },
        });
        
        expect(stillProcessing?.status).toBe("processing");
        expect(stillProcessing?.claim_token).toBe(reclaimResult.claimToken); // New owner's token
        
        // Reclaimer marks processed with correct token (should succeed)
        await markWebhookProcessed(prisma, reclaimResult.id, reclaimResult.claimToken);
        
        const processed = await prisma.webhookEvent.findUnique({
          where: { id: firstResult.id },
          select: { status: true },
        });
        
        expect(processed?.status).toBe("processed");
      }
    }
  });

  it("dispute alert: livemode false sends 0 emails then livemode true sends 1", async () => {
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_dispute_${Date.now()}`,
        link_token: `dispute_token_${Date.now()}`,
        email_normalized: "dispute-aff@example.com",
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    const regResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `dispute-${Date.now()}@example.com`,
        password: "Password123!",
        viaToken: affiliate.link_token,
      },
    });
    expect(regResponse.statusCode).toBe(201);
    const { user } = JSON.parse(regResponse.body);
    createdUserIds.push(user.id);

    const sessionId = JSON.parse(regResponse.body).sessionId;
    const orgResponse = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name: "Dispute Org" },
    });
    expect(orgResponse.statusCode).toBe(201);
    const { id: orgId } = JSON.parse(orgResponse.body);
    createdOrgIds.push(orgId);

    const customerId = `cus_dispute_${Date.now()}`;
    const chargeId = `ch_dispute_${Date.now()}`;
    await prisma.organization.update({
      where: { id: orgId },
      data: { stripe_customer_id: customerId },
    });
    mockChargesRetrieve.mockResolvedValue({
      id: chargeId,
      customer: customerId,
    });

    async function postDispute(livemode: boolean, eventId: string) {
      createdWebhookEventKeys.push(eventId);
      const event = {
        id: eventId,
        type: "charge.dispute.created",
        data: {
          object: {
            id: `dp_${eventId}`,
            charge: chargeId,
            amount: 1500,
            currency: "usd",
            reason: "fraudulent",
            livemode,
          },
        },
      };
      const { payload, header } = signStripeEvent(event);
      return app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": header,
        },
        payload,
      });
    }

    const testMode = await postDispute(false, `evt_dispute_test_${Date.now()}`);
    expect(testMode.statusCode).toBe(200);
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();

    const liveMode = await postDispute(true, `evt_dispute_live_${Date.now()}`);
    expect(liveMode.statusCode).toBe(200);
    expect(mockSendTransactionalEmail).toHaveBeenCalledTimes(1);
  });
});

(RUN_DB_TESTS ? describe : describe.skip)("Self-referral protection (integration)", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdAffiliateIds: string[] = [];
  const createdReferralIds: string[] = [];
  const createdWebhookEventKeys: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    originalEnv = snapshotEnv();
    applyAffiliateTestEnv();
  });

  afterAll(async () => {
    await cleanupAffiliateFixtures(prisma, {
      userIds: createdUserIds,
      orgIds: createdOrgIds,
      affiliateIds: createdAffiliateIds,
      referralIds: createdReferralIds,
      webhookEventKeys: createdWebhookEventKeys,
    });
    restoreEnv(originalEnv);
  });

  beforeEach(async () => {
    resetStripeMocks();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await cleanupAffiliateFixtures(prisma, {
      userIds: createdUserIds,
      orgIds: createdOrgIds,
      affiliateIds: createdAffiliateIds,
      referralIds: createdReferralIds,
      webhookEventKeys: createdWebhookEventKeys,
    });
  });

  it("register: self-referral via token is rejected", async () => {
    const email = `self-ref-register-${Date.now()}@example.com`;
    
    // Create affiliate with normalized email matching user
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_self_${Date.now()}`,
        link_token: `token_self_${Date.now()}`,
        email_normalized: email.toLowerCase(),
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Try to register with the affiliate's via token
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email,
        password: "Password123!",
        viaToken: affiliate.link_token,
      },
    });

    // Registration should succeed
    expect(registerResponse.statusCode).toBe(201);
    const body = JSON.parse(registerResponse.body);
    createdUserIds.push(body.user.id);

    // Check UserReferral was NOT created (self-referral rejected)
    const userReferral = await prisma.userReferral.findUnique({
      where: { user_id: body.user.id },
    });
    expect(userReferral).toBeNull();
  });

  it("register: non-self-referral via token creates referral (positive control)", async () => {
    const userEmail = `valid-ref-register-${Date.now()}@example.com`;
    const affiliateEmail = `affiliate-${Date.now()}@example.com`;
    
    // Create affiliate with different email
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_valid_${Date.now()}`,
        link_token: `token_valid_${Date.now()}`,
        email_normalized: affiliateEmail.toLowerCase(),
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Register with the affiliate's via token
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: userEmail,
        password: "Password123!",
        viaToken: affiliate.link_token,
      },
    });

    // Registration should succeed
    expect(registerResponse.statusCode).toBe(201);
    const body = JSON.parse(registerResponse.body);
    createdUserIds.push(body.user.id);

    // Check UserReferral WAS created (valid referral)
    const userReferral = await prisma.userReferral.findUnique({
      where: { user_id: body.user.id },
    });
    expect(userReferral).toBeTruthy();
    expect(userReferral?.affiliate_id).toBe(affiliate.id);
    expect(userReferral?.via_token).toBe(affiliate.link_token);
    // Status should be ACTIVE because affiliate is resolved via token
    expect(userReferral?.status).toBe("ACTIVE");
  });

  it("org attribution: self-referral with matching affiliate email is rejected", async () => {
    const email = `self-org-${Date.now()}@example.com`;
    
    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password_hash: "dummy",
      },
    });
    createdUserIds.push(user.id);

    // Create affiliate with same email
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_self_org_${Date.now()}`,
        email_normalized: email.toLowerCase(),
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Create UserReferral (simulating they clicked an affiliate link before realizing it was their own)
    await prisma.userReferral.create({
      data: {
        user_id: user.id,
        affiliate_id: affiliate.id,
        rewardful_referral_id: `ref_self_org_${Date.now()}`,
        source: "link",
      },
    });

    // Create organization (triggers attribution)
    const org = await prisma.organization.create({
      data: {
        name: "Self Org",
        
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org.id);

    // Trigger attribution manually
    const { attributeOrganizationToAffiliate } = await import("../lib/organization-attribution.js");
    const stripe = new (await import("stripe")).default(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
    
    const result = await attributeOrganizationToAffiliate(
      prisma,
      stripe,
      {
        organizationId: org.id,
        organizationName: org.name,
        userId: user.id,
      }
    );

    // Should be rejected as self-referral
    expect(result.kind).toBe("rejected_self_referral");

    // Check OrganizationReferral was created with rejection reason
    const orgReferral = await prisma.organizationReferral.findUnique({
      where: { organization_id: org.id },
      select: { affiliate_id: true, needs_attention: true, attention_reason: true },
    });
    
    expect(orgReferral?.affiliate_id).toBeNull();
    expect(orgReferral?.needs_attention).toBe(true);
    expect(orgReferral?.attention_reason).toBe("rejected_self_referral");
    if (orgReferral) createdReferralIds.push(org.id);
  });

  it("webhook completion: self-referral with matching email is rejected", async () => {
    const email = `self-webhook-${Date.now()}@example.com`;
    
    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password_hash: "dummy",
      },
    });
    createdUserIds.push(user.id);

    // Create affiliate with same normalized email
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_self_webhook_${Date.now()}`,
        email_normalized: email.toLowerCase(),
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Create org
    const org = await prisma.organization.create({
      data: {
        name: "Self Webhook Org",
        
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org.id);

    // Create unresolved OrganizationReferral (affiliate_id null)
    const rewardfulReferralId = `ref_self_webhook_${Date.now()}`;
    const referral = await prisma.organizationReferral.create({
      data: {
        organization_id: org.id,
        affiliate_id: null,
        rewardful_referral_id: rewardfulReferralId,
        source: "link",
      },
    });
    createdReferralIds.push(referral.id);

    // Simulate Rewardful webhook (referral.converted)
    const selfWebhookEventId = `evt_self_webhook_${Date.now()}`;
    createdWebhookEventKeys.push(selfWebhookEventId);
    const rewardfulPayload = {
      event: {
        id: selfWebhookEventId,
        type: "referral.converted",
      },
      object: {
        id: rewardfulReferralId,
        affiliate: { id: affiliate.rewardful_affiliate_id },
        state: "converted",
      },
    };

    const signature = crypto
      .createHmac("sha256", process.env.REWARDFUL_WEBHOOK_SECRET || "test_secret")
      .update(JSON.stringify(rewardfulPayload))
      .digest("hex");

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/rewardful",
      headers: {
        "x-rewardful-signature": signature,
        "content-type": "application/json",
      },
      payload: rewardfulPayload,
    });

    expect(response.statusCode).toBe(200);

    // Check that self-referral was rejected
    const updatedReferral = await prisma.organizationReferral.findUnique({
      where: { id: referral.id },
      select: { affiliate_id: true, needs_attention: true, attention_reason: true },
    });

    expect(updatedReferral?.affiliate_id).toBeNull(); // Not attributed
    expect(updatedReferral?.needs_attention).toBe(true);
    expect(updatedReferral?.attention_reason).toBe("rejected_self_referral");
  });

  it("gmail/googlemail normalization: treats as equivalent for self-referral check", async () => {
    const email = `self-gmail-${Date.now()}@gmail.com`;
    const googlemailEmail = email.replace("@gmail.com", "@googlemail.com");
    
    // Create user with @gmail.com
    const user = await prisma.user.create({
      data: {
        email,
        password_hash: "dummy",
      },
    });
    createdUserIds.push(user.id);

    // Create affiliate with @googlemail.com
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_gmail_${Date.now()}`,
        email_normalized: googlemailEmail.toLowerCase().replace("@googlemail.com", "@gmail.com"),
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Create UserReferral
    await prisma.userReferral.create({
      data: {
        user_id: user.id,
        affiliate_id: affiliate.id,
        rewardful_referral_id: `ref_gmail_${Date.now()}`,
        source: "link",
      },
    });

    // Create organization
    const org = await prisma.organization.create({
      data: {
        name: "Gmail Org",
        
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org.id);

    // Trigger attribution
    const { attributeOrganizationToAffiliate } = await import("../lib/organization-attribution.js");
    const stripe = new (await import("stripe")).default(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
    
    const result = await attributeOrganizationToAffiliate(
      prisma,
      stripe,
      {
        organizationId: org.id,
        organizationName: org.name,
        userId: user.id,
      }
    );

    // Should be rejected due to gmail/googlemail normalization
    expect(result.kind).toBe("rejected_self_referral");
    
    const orgReferral = await prisma.organizationReferral.findUnique({
      where: { organization_id: org.id },
    });
    if (orgReferral) createdReferralIds.push(orgReferral.id);
  });
});

(RUN_DB_TESTS ? describe : describe.skip)("First-org-only attribution (integration)", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdAffiliateIds: string[] = [];
  const createdReferralIds: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    originalEnv = snapshotEnv();
    applyAffiliateTestEnv();
  });

  afterAll(async () => {
    await cleanupAffiliateFixtures(prisma, {
      userIds: createdUserIds,
      orgIds: createdOrgIds,
      affiliateIds: createdAffiliateIds,
      referralIds: createdReferralIds,
    });
    restoreEnv(originalEnv);
  });

  beforeEach(async () => {
    resetStripeMocks();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await cleanupAffiliateFixtures(prisma, {
      userIds: createdUserIds,
      orgIds: createdOrgIds,
      affiliateIds: createdAffiliateIds,
      referralIds: createdReferralIds,
    });
  });

  it("delete-and-recreate: doesn't re-attribute after first org is deleted", async () => {
    const email = `first-org-${Date.now()}@example.com`;
    
    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password_hash: "dummy",
      },
    });
    createdUserIds.push(user.id);

    // Create affiliate
    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_first_${Date.now()}`,
        email_normalized: "different@example.com",
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    // Create UserReferral
    await prisma.userReferral.create({
      data: {
        user_id: user.id,
        affiliate_id: affiliate.id,
        rewardful_referral_id: `ref_first_${Date.now()}`,
        source: "link",
      },
    });

    // Create first organization
    const org1 = await prisma.organization.create({
      data: {
        name: "First Org",
        
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org1.id);

    // Trigger attribution for first org
    const { attributeOrganizationToAffiliate } = await import("../lib/organization-attribution.js");
    const stripe = new (await import("stripe")).default(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
    
    const result1 = await attributeOrganizationToAffiliate(
      prisma,
      stripe,
      {
        organizationId: org1.id,
        organizationName: org1.name,
        userId: user.id,
      }
    );

    expect(result1.kind).toBe("attributed");
    
    const referral1 = await prisma.organizationReferral.findUnique({
      where: { organization_id: org1.id },
    });
    expect(referral1?.affiliate_id).toBe(affiliate.id);
    if (referral1) createdReferralIds.push(referral1.id);

    // Soft-delete first org
    await prisma.organization.update({
      where: { id: org1.id },
      data: { deleted_at: new Date() },
    });

    // Create second organization as OWNER
    const org2 = await prisma.organization.create({
      data: {
        name: "Second Org",
        
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org2.id);

    // Trigger attribution for second org
    const result2 = await attributeOrganizationToAffiliate(
      prisma,
      stripe,
      {
        organizationId: org2.id,
        organizationName: org2.name,
        userId: user.id,
      }
    );

    // Should NOT be attributed (first-org-only rule based on existing attribution, not org count)
    expect(result2.kind).toBe("not_referred");

    const referral2 = await prisma.organizationReferral.findUnique({
      where: { organization_id: org2.id },
    });
    expect(referral2).toBeNull();
  });
});
