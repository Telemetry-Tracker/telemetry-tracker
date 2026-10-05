/**
 * Extra affiliate protections: checkout metadata, dispute email, self-referral aliases.
 * Run with: RUN_DB_INTEGRATION_TESTS=true pnpm test affiliates-protections.integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import type Stripe from "stripe";
import {
  applyAffiliateTestEnv,
  cleanupAffiliateFixtures,
  referralCapturedAtDaysAgo,
  REFERRAL_ATTRIBUTION_WINDOW_DAYS,
  restoreEnv,
  signStripeEvent,
  snapshotEnv,
} from "./affiliate-test-helpers.js";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

const sendTransactionalEmail = vi.fn();
vi.mock("../lib/email.js", () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendTransactionalEmail(...args),
}));

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
    id: `cus_${Date.now()}`,
    metadata: params?.metadata ?? {},
  }));
  mockCustomersRetrieve = vi.fn().mockImplementation(async (id) => ({
    id,
    deleted: false,
    metadata: {},
  }));
  mockCustomersUpdate = vi.fn().mockImplementation(async (id, params) => ({ id, ...params }));
  mockSubscriptionsRetrieve = vi.fn().mockResolvedValue({
    id: "sub_test",
    status: "active",
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  });
  mockChargesRetrieve = vi.fn().mockResolvedValue({
    id: "ch_test",
    customer: "cus_test",
    invoice: null,
  });
}

resetStripeMocks();

vi.mock("stripe", () => {
  const mockStripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args) } },
    customers: {
      create: (...args: unknown[]) => mockCustomersCreate(...args),
      retrieve: (...args: unknown[]) => mockCustomersRetrieve(...args),
      update: (...args: unknown[]) => mockCustomersUpdate(...args),
    },
    subscriptions: { retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args) },
    charges: { retrieve: (...args: unknown[]) => mockChargesRetrieve(...args) },
    webhooks: {
      constructEvent: (payload: Buffer | string) =>
        JSON.parse(typeof payload === "string" ? payload : payload.toString()),
    },
  }));
  return { default: mockStripe };
});

testSuite("Affiliate protections", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  const testOrgIds: string[] = [];
  const testAffiliateIds: string[] = [];
  const testWebhookEventKeys: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    originalEnv = snapshotEnv();
    applyAffiliateTestEnv();
  });

  afterAll(async () => {
    await cleanupAffiliateFixtures(prisma, {
      userIds: testUserIds,
      orgIds: testOrgIds,
      affiliateIds: testAffiliateIds,
      webhookEventKeys: testWebhookEventKeys,
    });
    restoreEnv(originalEnv);
  });

  beforeEach(async () => {
    resetStripeMocks();
    sendTransactionalEmail.mockReset();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await cleanupAffiliateFixtures(prisma, {
      userIds: testUserIds,
      orgIds: testOrgIds,
      affiliateIds: testAffiliateIds,
      webhookEventKeys: testWebhookEventKeys,
    });
    await app.close();
  });

  async function seedReferredOrg(status: "EXPIRED" | "REJECTED" | "ACTIVE") {
    const affiliate = await prisma.affiliate.create({
      data: {
        code: `prot-${status.toLowerCase()}-${Date.now()}`,
        name: "Prot",
        email: "prot@example.com",
        email_normalized: "prot@example.com",
        state: "active",
      },
    });
    testAffiliateIds.push(affiliate.id);
    const capturedAt =
      status === "EXPIRED"
        ? referralCapturedAtDaysAgo(REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1)
        : new Date();
    const email =
      status === "REJECTED"
        ? "prot@example.com"
        : `prot-user-${Date.now()}@example.com`;
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email,
        password: "Password123!",
        referralCode: affiliate.code,
        referralCapturedAt: capturedAt.toISOString(),
      },
    });
    expect(reg.statusCode).toBe(201);
    const { user, sessionId } = JSON.parse(reg.body);
    testUserIds.push(user.id);
    const orgRes = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name: `${status} Org` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = JSON.parse(orgRes.body).id as string;
    testOrgIds.push(orgId);
    return { orgId, sessionId, affiliate };
  }

  it("omits tt_* on checkout for expired and rejected referrals", async () => {
    const expired = await seedReferredOrg("EXPIRED");
    const expiredCheckout = await app.inject({
      method: "POST",
      url: `/api/meta/organizations/${expired.orgId}/billing/checkout`,
      headers: { cookie: `telemetry_session=${expired.sessionId}` },
      payload: { planTier: "PRO" },
    });
    expect(expiredCheckout.statusCode).toBe(200);
    expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();

    const rejected = await seedReferredOrg("REJECTED");
    const rejectedCheckout = await app.inject({
      method: "POST",
      url: `/api/meta/organizations/${rejected.orgId}/billing/checkout`,
      headers: { cookie: `telemetry_session=${rejected.sessionId}` },
      payload: { planTier: "PRO" },
    });
    expect(rejectedCheckout.statusCode).toBe(200);
    expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
  });

  it("sends dispute email only for livemode disputes", async () => {
    const { orgId, affiliate } = await seedReferredOrg("ACTIVE");
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { stripe_customer_id: true },
    });
    mockChargesRetrieve.mockResolvedValue({
      id: "ch_dispute",
      customer: org?.stripe_customer_id,
      invoice: null,
    });

    const testEvent = {
      id: `evt_dsp_test_${Date.now()}`,
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_test",
          charge: "ch_dispute",
          amount: 2900,
          currency: "eur",
          reason: "fraudulent",
          status: "needs_response",
          livemode: false,
        },
      },
    };
    testWebhookEventKeys.push(testEvent.id);
    const testSigned = signStripeEvent(testEvent);
    await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": testSigned.header },
      payload: testSigned.payload,
    });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();

    const liveEvent = {
      id: `evt_dsp_live_${Date.now()}`,
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_live",
          charge: "ch_dispute",
          amount: 2900,
          currency: "eur",
          reason: "fraudulent",
          status: "needs_response",
          livemode: true,
        },
      },
    };
    testWebhookEventKeys.push(liveEvent.id);
    const liveSigned = signStripeEvent(liveEvent);
    await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": liveSigned.header },
      payload: liveSigned.payload,
    });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(affiliate.id).toBeTruthy();
  });

  it("treats gmail aliases as self-referral", async () => {
    const affiliate = await prisma.affiliate.create({
      data: {
        code: `gmail-${Date.now()}`,
        name: "Gmail",
        email: "first.last@gmail.com",
        email_normalized: "firstlast@gmail.com",
        state: "active",
      },
    });
    testAffiliateIds.push(affiliate.id);
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "first.last+tag@googlemail.com",
        password: "Password123!",
        referralCode: affiliate.code,
      },
    });
    expect(reg.statusCode).toBe(201);
    const { user } = JSON.parse(reg.body);
    testUserIds.push(user.id);
    expect(await prisma.userReferral.findUnique({ where: { user_id: user.id } })).toBeNull();
  });
});
