/**
 * Native affiliate program integration tests.
 * Run with: RUN_DB_INTEGRATION_TESTS=true pnpm test affiliates.integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
import { PAYOUT_MINIMUM_CENTS, markAffiliatePayoutPaid } from "../lib/affiliate-payout.js";
import {
  applyDisputeToCommission,
  applyRefundToCommission,
  COMMISSION_NOT_FOUND_ATTENTION_REASON,
} from "../lib/affiliate-commission.js";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

let capturedCheckoutArgs: Stripe.Checkout.SessionCreateParams | null = null;
let mockCheckoutSessionsCreate: ReturnType<typeof vi.fn>;
let mockCustomersCreate: ReturnType<typeof vi.fn>;
let mockCustomersRetrieve: ReturnType<typeof vi.fn>;
let mockCustomersUpdate: ReturnType<typeof vi.fn>;
let mockSubscriptionsRetrieve: ReturnType<typeof vi.fn>;
let mockChargesRetrieve: ReturnType<typeof vi.fn>;
let mockInvoicePaymentsList: ReturnType<typeof vi.fn>;

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
    invoice: null,
    payment_intent: null,
  });
  mockInvoicePaymentsList = vi.fn().mockResolvedValue({ data: [] });
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
    invoicePayments: {
      list: (...args: unknown[]) => mockInvoicePaymentsList(...args),
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

testSuite("Native affiliate integration", () => {
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

  async function createAffiliate(opts?: {
    code?: string;
    email?: string | null;
    state?: "active" | "disabled";
  }) {
    const affiliate = await prisma.affiliate.create({
      data: {
        code: opts?.code ?? `aff-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name: "Test Affiliate",
        email: opts?.email === undefined ? "affiliate@example.com" : opts.email,
        email_normalized:
          opts?.email === undefined
            ? "affiliate@example.com"
            : opts.email
              ? opts.email.toLowerCase()
              : null,
        state: opts?.state ?? "active",
      },
    });
    testAffiliateIds.push(affiliate.id);
    return affiliate;
  }

  async function registerUser(payload: Record<string, unknown>) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        password: "Password123!",
        displayName: "Test User",
        ...payload,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as {
      user: { id: string; email: string };
      sessionId: string;
    };
    testUserIds.push(body.user.id);
    return body;
  }

  async function createOrg(sessionId: string, name = "Referred Org") {
    const response = await app.inject({
      method: "POST",
      url: "/api/meta/organizations",
      headers: { cookie: `telemetry_session=${sessionId}` },
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { id: string };
    testOrgIds.push(body.id);
    return body.id;
  }

  async function postStripeEvent(event: Record<string, unknown>) {
    testWebhookEventKeys.push(String(event.id));
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

  async function paidInvoice(opts: {
    orgId: string;
    invoiceId: string;
    amountPaid: number;
    tax?: number;
    chargeId?: string;
    customerId?: string;
    subscriptionId?: string;
    paidAt?: Date;
    basil?: boolean;
    paymentIntentId?: string;
  }) {
    const org = await prisma.organization.findUnique({
      where: { id: opts.orgId },
      select: { stripe_customer_id: true, stripe_subscription_id: true },
    });
    const subscriptionId =
      opts.subscriptionId ?? org?.stripe_subscription_id ?? "sub_hosted";
    const paymentIntentId = opts.paymentIntentId ?? (opts.basil ? `pi_${opts.invoiceId}` : undefined);
    const object: Record<string, unknown> = {
      id: opts.invoiceId,
      amount_paid: opts.amountPaid,
      tax: opts.tax ?? 0,
      currency: "eur",
      customer: opts.customerId ?? org?.stripe_customer_id,
      billing_reason: "subscription_cycle",
      status_transitions: {
        paid_at: Math.floor((opts.paidAt ?? new Date()).getTime() / 1000),
      },
    };
    if (opts.basil) {
      object.parent = { subscription_details: { subscription: subscriptionId } };
      object.payments = {
        object: "list",
        data: [
          {
            id: `inpay_${opts.invoiceId}`,
            status: "paid",
            payment: {
              type: "payment_intent",
              payment_intent: paymentIntentId,
            },
          },
        ],
      };
    } else {
      object.subscription = subscriptionId;
      object.charge = opts.chargeId ?? `ch_${opts.invoiceId}`;
      if (paymentIntentId) object.payment_intent = paymentIntentId;
    }
    const event = {
      id: `evt_${opts.invoiceId}`,
      type: "invoice.paid",
      data: { object },
    };
    return postStripeEvent(event);
  }

  describe("referral capture and attribution", () => {
    it("captures a valid referral link at registration", async () => {
      const affiliate = await createAffiliate({ code: "alice" });
      const { user } = await registerUser({
        email: `user${Date.now()}@example.com`,
        referralCode: "Alice",
      });
      const referral = await prisma.userReferral.findUnique({ where: { user_id: user.id } });
      expect(referral?.affiliate_id).toBe(affiliate.id);
      expect(referral?.referral_code).toBe("alice");
      expect(referral?.status).toBe("ACTIVE");
    });

    it("ignores an invalid code", async () => {
      const { user } = await registerUser({
        email: `user${Date.now()}@example.com`,
        referralCode: "not a code!",
      });
      expect(await prisma.userReferral.findUnique({ where: { user_id: user.id } })).toBeNull();
    });

    it("ignores unknown and disabled affiliate codes", async () => {
      await createAffiliate({ code: "disabled-aff", state: "disabled" });
      const missing = await registerUser({
        email: `missing${Date.now()}@example.com`,
        referralCode: "nobody",
      });
      const disabled = await registerUser({
        email: `disabled${Date.now()}@example.com`,
        referralCode: "disabled-aff",
      });
      expect(await prisma.userReferral.findUnique({ where: { user_id: missing.user.id } })).toBeNull();
      expect(await prisma.userReferral.findUnique({ where: { user_id: disabled.user.id } })).toBeNull();
    });

    it("treats day 60 as valid and day 61 as expired", async () => {
      const affiliate = await createAffiliate({ code: "window" });
      const day60 = await registerUser({
        email: `d60-${Date.now()}@example.com`,
        referralCode: affiliate.code,
        referralCapturedAt: referralCapturedAtDaysAgo(
          REFERRAL_ATTRIBUTION_WINDOW_DAYS,
          60_000
        ).toISOString(),
      });
      const day61 = await registerUser({
        email: `d61-${Date.now()}@example.com`,
        referralCode: affiliate.code,
        referralCapturedAt: referralCapturedAtDaysAgo(
          REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1
        ).toISOString(),
      });
      expect((await prisma.userReferral.findUnique({ where: { user_id: day60.user.id } }))?.status).toBe(
        "ACTIVE"
      );
      expect((await prisma.userReferral.findUnique({ where: { user_id: day61.user.id } }))?.status).toBe(
        "EXPIRED"
      );
    });

    it("locks last-touch at signup and ignores later codes", async () => {
      const first = await createAffiliate({ code: "first-touch" });
      await createAffiliate({ code: "second-touch" });
      const { user, sessionId } = await registerUser({
        email: `lock${Date.now()}@example.com`,
        referralCode: first.code,
      });
      const orgId = await createOrg(sessionId);
      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { referral_code: "second-touch" },
      });
      const secondOrg = await app.inject({
        method: "POST",
        url: "/api/meta/organizations",
        headers: { cookie: `telemetry_session=${sessionId}` },
        payload: { name: "Second Org" },
      });
      expect(secondOrg.statusCode).toBe(201);
      const secondId = JSON.parse(secondOrg.body).id as string;
      testOrgIds.push(secondId);
      const firstRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      const secondRef = await prisma.organizationReferral.findUnique({
        where: { organization_id: secondId },
      });
      expect(firstRef?.affiliate_id).toBe(first.id);
      expect(secondRef).toBeNull();
    });

    it("does not attribute an existing account that later uses a link", async () => {
      await createAffiliate({ code: "late" });
      const { user, sessionId } = await registerUser({
        email: `existing${Date.now()}@example.com`,
      });
      expect(await prisma.userReferral.findUnique({ where: { user_id: user.id } })).toBeNull();
      const orgId = await createOrg(sessionId, "Existing Org");
      expect(
        await prisma.organizationReferral.findUnique({ where: { organization_id: orgId } })
      ).toBeNull();
      // Login / later visits are not a capture path — only /auth/register writes UserReferral.
      const later = await registerUser({
        email: `later-existing${Date.now()}@example.com`,
      });
      const laterOrg = await createOrg(later.sessionId, "Later Existing");
      expect(
        await prisma.organizationReferral.findUnique({ where: { organization_id: laterOrg } })
      ).toBeNull();
    });

    it("rejects self-referral", async () => {
      const email = `self-${Date.now()}@example.com`;
      await createAffiliate({ code: "selfref", email });
      const { user } = await registerUser({
        email,
        referralCode: "selfref",
      });
      const referral = await prisma.userReferral.findUnique({ where: { user_id: user.id } });
      expect(referral).toBeNull();
    });
  });

  describe("commissions from Stripe invoices", () => {
    async function referredPaidOrg(code = `pro-${Date.now()}`) {
      const affiliate = await createAffiliate({ code });
      const { sessionId } = await registerUser({
        email: `paid${Date.now()}@example.com`,
        referralCode: code,
      });
      const orgId = await createOrg(sessionId);
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          plan_tier: "PRO",
          stripe_customer_id: `cus_${orgId.slice(0, 8)}`,
          stripe_subscription_id: `sub_${orgId.slice(0, 8)}`,
        },
      });
      return { affiliate, orgId, sessionId };
    }

    it("records 30% for Pro and Business and excludes tax, discounts, and zero-paid", async () => {
      const { orgId } = await referredPaidOrg(`money-${Date.now()}`);
      const pro = await paidInvoice({
        orgId,
        invoiceId: `in_pro_${Date.now()}`,
        amountPaid: 3509,
        tax: 609,
      });
      expect(pro.statusCode).toBe(200);
      const created = await prisma.affiliateCommission.findMany({
        where: { organization_id: orgId },
      });
      expect(created).toHaveLength(1);
      expect(created[0]?.eligible_base_cents).toBe(2900);
      expect(created[0]?.amount_cents).toBe(870);
      testCommissionIds.push(created[0]!.id);

      const businessOrg = await referredPaidOrg(`biz-${Date.now()}`);
      await prisma.organization.update({
        where: { id: businessOrg.orgId },
        data: { plan_tier: "BUSINESS" },
      });
      await paidInvoice({
        orgId: businessOrg.orgId,
        invoiceId: `in_biz_${Date.now()}`,
        amountPaid: 2000,
        tax: 0,
      });
      const biz = await prisma.affiliateCommission.findMany({
        where: { organization_id: businessOrg.orgId },
      });
      expect(biz[0]?.amount_cents).toBe(600);
      testCommissionIds.push(...biz.map((row) => row.id));

      const discounted = await paidInvoice({
        orgId,
        invoiceId: `in_disc_${Date.now()}`,
        amountPaid: 1000,
        tax: 0,
      });
      expect(discounted.statusCode).toBe(200);
      const afterDiscount = await prisma.affiliateCommission.findMany({
        where: { organization_id: orgId },
      });
      expect(afterDiscount.some((row) => row.eligible_base_cents === 1000)).toBe(true);

      const zero = await paidInvoice({
        orgId,
        invoiceId: `in_zero_${Date.now()}`,
        amountPaid: 0,
        tax: 0,
      });
      expect(zero.statusCode).toBe(200);
      const zeroRows = await prisma.affiliateCommission.findMany({
        where: { stripe_invoice_id: { startsWith: "in_zero_" } },
      });
      expect(zeroRows).toHaveLength(0);
    });

    it("skips commissions for Free-tier orgs even on a hosted subscription invoice", async () => {
      const { orgId } = await referredPaidOrg(`free-${Date.now()}`);
      await prisma.organization.update({
        where: { id: orgId },
        data: { plan_tier: "FREE" },
      });
      await paidInvoice({
        orgId,
        invoiceId: `in_free_${Date.now()}`,
        amountPaid: 2900,
      });
      expect(await prisma.affiliateCommission.count({ where: { organization_id: orgId } })).toBe(0);
    });

    it("Free→paid after the 60-day window still commissions the locked affiliate", async () => {
      const affiliate = await createAffiliate({ code: `latepay-${Date.now()}` });
      const { sessionId, user } = await registerUser({
        email: `latepay${Date.now()}@example.com`,
        referralCode: affiliate.code,
        referralCapturedAt: referralCapturedAtDaysAgo(10).toISOString(),
      });
      const orgId = await createOrg(sessionId);
      await prisma.userReferral.update({
        where: { user_id: user.id },
        data: { captured_at: referralCapturedAtDaysAgo(90) },
      });
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          plan_tier: "PRO",
          stripe_customer_id: `cus_late_${orgId.slice(0, 8)}`,
          stripe_subscription_id: `sub_late_${orgId.slice(0, 8)}`,
        },
      });
      await paidInvoice({
        orgId,
        invoiceId: `in_late_${Date.now()}`,
        amountPaid: 2900,
      });
      const rows = await prisma.affiliateCommission.findMany({ where: { organization_id: orgId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.affiliate_id).toBe(affiliate.id);
      testCommissionIds.push(rows[0]!.id);
    });

    it("creates another commission for a recurring invoice and is idempotent", async () => {
      const { orgId } = await referredPaidOrg(`recur-${Date.now()}`);
      const invoiceId = `in_recur_${Date.now()}`;
      const first = await paidInvoice({ orgId, invoiceId, amountPaid: 2900 });
      const second = await paidInvoice({ orgId, invoiceId, amountPaid: 2900 });
      const next = await paidInvoice({
        orgId,
        invoiceId: `${invoiceId}_b`,
        amountPaid: 2900,
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(next.statusCode).toBe(200);
      const rows = await prisma.affiliateCommission.findMany({ where: { organization_id: orgId } });
      expect(rows).toHaveLength(2);
      testCommissionIds.push(...rows.map((row) => row.id));
    });

    it("does not commission self-hosted (non-subscription) invoices", async () => {
      const { orgId } = await referredPaidOrg(`selfhost-${Date.now()}`);
      const event = {
        id: `evt_selfhost_${Date.now()}`,
        type: "invoice.paid",
        data: {
          object: {
            id: `in_selfhost_${Date.now()}`,
            amount_paid: 9900,
            tax: 0,
            currency: "eur",
            customer: null,
            subscription: null,
            billing_reason: "manual",
          },
        },
      };
      const response = await postStripeEvent(event);
      expect(response.statusCode).toBe(200);
      expect(await prisma.affiliateCommission.count({ where: { organization_id: orgId } })).toBe(0);
    });

    it("skips new commissions when the affiliate is disabled", async () => {
      const { orgId, affiliate } = await referredPaidOrg(`off-${Date.now()}`);
      await prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { state: "disabled" },
      });
      await paidInvoice({ orgId, invoiceId: `in_off_${Date.now()}`, amountPaid: 2900 });
      expect(await prisma.affiliateCommission.count({ where: { organization_id: orgId } })).toBe(0);
    });

    it("does not commission after cancellation, then commissions again on resubscription", async () => {
      const { orgId } = await referredPaidOrg(`cancel-${Date.now()}`);
      const firstId = `in_before_cancel_${Date.now()}`;
      await paidInvoice({ orgId, invoiceId: firstId, amountPaid: 2900 });
      await postStripeEvent({
        id: `evt_subdel_${Date.now()}`,
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: (await prisma.organization.findUnique({ where: { id: orgId } }))
              ?.stripe_subscription_id,
            status: "canceled",
          },
        },
      });
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          stripe_subscription_id: `sub_resub_${orgId.slice(0, 8)}`,
          stripe_customer_id:
            (await prisma.organization.findUnique({ where: { id: orgId } }))?.stripe_customer_id ??
            `cus_resub_${orgId.slice(0, 8)}`,
          plan_tier: "PRO",
        },
      });
      await paidInvoice({
        orgId,
        invoiceId: `in_resub_${Date.now()}`,
        amountPaid: 2900,
      });
      const rows = await prisma.affiliateCommission.findMany({ where: { organization_id: orgId } });
      expect(rows).toHaveLength(2);
      testCommissionIds.push(...rows.map((row) => row.id));
    });
  });

  describe("refunds, disputes, and payouts", () => {
    async function pendingCommission(amount = 2900) {
      const affiliate = await createAffiliate({ code: `pay-${Date.now()}` });
      const { sessionId } = await registerUser({
        email: `pay${Date.now()}@example.com`,
        referralCode: affiliate.code,
      });
      const orgId = await createOrg(sessionId);
      const customerId = `cus_pay_${orgId.slice(0, 8)}`;
      const chargeId = `ch_pay_${Date.now()}`;
      const invoiceId = `in_pay_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          plan_tier: "PRO",
          stripe_customer_id: customerId,
          stripe_subscription_id: `sub_pay_${orgId.slice(0, 8)}`,
        },
      });
      await paidInvoice({
        orgId,
        invoiceId,
        amountPaid: amount,
        chargeId,
        customerId,
      });
      const commission = await prisma.affiliateCommission.findUnique({
        where: { stripe_invoice_id: invoiceId },
      });
      expect(commission).toBeTruthy();
      testCommissionIds.push(commission!.id);
      return { affiliate, orgId, commission: commission!, invoiceId, chargeId, customerId };
    }

    it("reduces or voids a commission on refund before payout", async () => {
      const partial = await pendingCommission(2900);
      await postStripeEvent({
        id: `evt_ref_partial_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: partial.chargeId,
            invoice: partial.invoiceId,
            amount: 2900,
            amount_refunded: 1450,
            currency: "eur",
            refunds: { data: [{ id: "re_partial" }] },
          },
        },
      });
      const reduced = await prisma.affiliateCommission.findUnique({
        where: { id: partial.commission.id },
      });
      expect(reduced?.state).toBe("pending");
      expect(reduced?.remaining_cents).toBe(435);

      const full = await pendingCommission(2900);
      await postStripeEvent({
        id: `evt_ref_full_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: full.chargeId,
            invoice: full.invoiceId,
            amount: 2900,
            amount_refunded: 2900,
            currency: "eur",
            refunds: { data: [{ id: "re_full" }] },
          },
        },
      });
      const voided = await prisma.affiliateCommission.findUnique({ where: { id: full.commission.id } });
      expect(voided?.state).toBe("voided");
      expect(voided?.remaining_cents).toBe(0);
    });

    it("creates a negative adjustment for a refund after payout", async () => {
      const { affiliate, commission } = await pendingCommission(16667);
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const adminEmail = `founder-pay-${Date.now()}@example.com`;
      process.env.AFFILIATE_ADMIN_EMAILS = adminEmail;
      const admin = await registerUser({ email: adminEmail });
      const paid = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/${affiliate.id}/payouts`,
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: {
          commissionIds: [commission.id],
          amountCents: commission.remaining_cents,
          idempotencyKey: `payout-${commission.id}`,
        },
      });
      expect(paid.statusCode).toBe(200);
      await postStripeEvent({
        id: `evt_ref_after_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: commission.stripe_charge_id,
            invoice: commission.stripe_invoice_id,
            amount: 16667,
            amount_refunded: 16667,
            currency: "eur",
            refunds: { data: [{ id: "re_after" }] },
          },
        },
      });
      const stillPaid = await prisma.affiliateCommission.findUnique({
        where: { id: commission.id },
      });
      expect(stillPaid?.state).toBe("paid");
      const adjustment = await prisma.affiliateAdjustment.findFirst({
        where: { commission_id: commission.id, reason: "refund" },
      });
      expect(adjustment?.amount_cents).toBe(-commission.amount_cents);
    });

    it("holds on open dispute, restores on win, voids or adjusts on loss", async () => {
      const openCase = await pendingCommission(2900);
      mockChargesRetrieve.mockResolvedValue({
        id: openCase.chargeId,
        customer: openCase.customerId,
        invoice: openCase.invoiceId,
      });
      await postStripeEvent({
        id: `evt_dsp_open_${Date.now()}`,
        type: "charge.dispute.created",
        data: {
          object: {
            id: `dp_open_${Date.now()}`,
            charge: openCase.chargeId,
            amount: 2900,
            currency: "eur",
            reason: "fraudulent",
            status: "needs_response",
            livemode: false,
          },
        },
      });
      expect(
        (await prisma.affiliateCommission.findUnique({ where: { id: openCase.commission.id } }))
          ?.dispute_status
      ).toBe("open");

      await postStripeEvent({
        id: `evt_dsp_won_${Date.now()}`,
        type: "charge.dispute.closed",
        data: {
          object: {
            id: `dp_won_${Date.now()}`,
            charge: openCase.chargeId,
            amount: 2900,
            currency: "eur",
            reason: "fraudulent",
            status: "won",
            livemode: false,
          },
        },
      });
      expect(
        (await prisma.affiliateCommission.findUnique({ where: { id: openCase.commission.id } }))
          ?.dispute_status
      ).toBe("won");

      const lost = await pendingCommission(2900);
      mockChargesRetrieve.mockResolvedValue({
        id: lost.chargeId,
        customer: lost.customerId,
        invoice: lost.invoiceId,
      });
      await postStripeEvent({
        id: `evt_dsp_lost_${Date.now()}`,
        type: "charge.dispute.closed",
        data: {
          object: {
            id: `dp_lost_${Date.now()}`,
            charge: lost.chargeId,
            amount: 2900,
            currency: "eur",
            reason: "fraudulent",
            status: "lost",
            livemode: false,
          },
        },
      });
      expect(
        (await prisma.affiliateCommission.findUnique({ where: { id: lost.commission.id } }))?.state
      ).toBe("voided");
    });

    it("enforces the €50 payout threshold and mark-as-paid idempotency", async () => {
      const affiliate = await createAffiliate({ code: `threshold-${Date.now()}` });
      const adminEmail = `founder-th-${Date.now()}@example.com`;
      process.env.AFFILIATE_ADMIN_EMAILS = adminEmail;
      const admin = await registerUser({ email: adminEmail });

      const small = await prisma.affiliateCommission.create({
        data: {
          affiliate_id: affiliate.id,
          organization_id: (
            await (async () => {
              const { sessionId } = await registerUser({
                email: `th-user-${Date.now()}@example.com`,
                referralCode: affiliate.code,
              });
              return createOrg(sessionId, "Threshold Org");
            })()
          ),
          stripe_invoice_id: `in_th_small_${Date.now()}`,
          eligible_base_cents: 16663,
          amount_cents: 4999,
          remaining_cents: 4999,
          currency: "eur",
          state: "pending",
          invoice_paid_at: new Date(),
          payable_at: new Date(Date.now() - 1000),
        },
      });
      testCommissionIds.push(small.id);
      const tooSmall = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/${affiliate.id}/payouts`,
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { commissionIds: [small.id], amountCents: 4999 },
      });
      expect(tooSmall.statusCode).toBe(400);
      expect(JSON.parse(tooSmall.body).code).toBe("below_minimum");

      await prisma.affiliateCommission.update({
        where: { id: small.id },
        data: { amount_cents: 5000, remaining_cents: 5000, eligible_base_cents: 16667 },
      });
      const key = `idem-${small.id}`;
      const first = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/${affiliate.id}/payouts`,
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { commissionIds: [small.id], amountCents: PAYOUT_MINIMUM_CENTS, idempotencyKey: key },
      });
      const second = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/${affiliate.id}/payouts`,
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { commissionIds: [small.id], amountCents: PAYOUT_MINIMUM_CENTS, idempotencyKey: key },
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body).idempotent).toBe(true);
      expect(JSON.parse(first.body).payoutId).toBe(JSON.parse(second.body).payoutId);
      expect(await prisma.affiliatePayout.count({ where: { affiliate_id: affiliate.id } })).toBe(1);
    });

    async function founderAdmin() {
      const adminEmail = `founder-ledger-${Date.now()}@example.com`;
      process.env.AFFILIATE_ADMIN_EMAILS = adminEmail;
      return registerUser({ email: adminEmail });
    }

    async function seedPayableCommission(
      affiliateId: string,
      organizationId: string,
      amountCents: number
    ) {
      const row = await prisma.affiliateCommission.create({
        data: {
          affiliate_id: affiliateId,
          organization_id: organizationId,
          stripe_invoice_id: `in_seed_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          eligible_base_cents: Math.ceil((amountCents * 10_000) / 3000),
          amount_cents: amountCents,
          remaining_cents: amountCents,
          currency: "eur",
          state: "pending",
          invoice_paid_at: new Date(),
          payable_at: new Date(Date.now() - 1000),
        },
      });
      testCommissionIds.push(row.id);
      return row;
    }

    async function markPaid(
      adminSessionId: string,
      affiliateId: string,
      payload: Record<string, unknown>
    ) {
      return app.inject({
        method: "POST",
        url: `/api/meta/affiliates/${affiliateId}/payouts`,
        headers: { cookie: `telemetry_session=${adminSessionId}` },
        payload,
      });
    }

    async function adminDetail(adminSessionId: string, affiliateId: string) {
      const response = await app.inject({
        method: "GET",
        url: `/api/meta/affiliates/${affiliateId}`,
        headers: { cookie: `telemetry_session=${adminSessionId}` },
      });
      expect(response.statusCode).toBe(200);
      return JSON.parse(response.body) as {
        pendingCents: number;
        payableCents: number;
        paidCents: number;
        adjustmentCents: number;
        currentPayableBalanceCents: number;
      };
    }

    async function paidThenClawback() {
      const { affiliate, commission, orgId } = await pendingCommission(16667);
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const admin = await founderAdmin();
      const paid = await markPaid(admin.sessionId, affiliate.id, {
        commissionIds: [commission.id],
        amountCents: commission.remaining_cents,
      });
      expect(paid.statusCode).toBe(200);
      await postStripeEvent({
        id: `evt_claw_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: commission.stripe_charge_id,
            invoice: commission.stripe_invoice_id,
            amount: 16667,
            amount_refunded: 16667,
            currency: "eur",
            refunds: { data: [{ id: `re_claw_${Date.now()}` }] },
          },
        },
      });
      const next = await seedPayableCommission(affiliate.id, orgId, 10000);
      return { affiliate, commission, next, admin };
    }

    it("does not double-count a pre-payout partial refund in payable balance", async () => {
      const partial = await pendingCommission(2900);
      await postStripeEvent({
        id: `evt_bal_partial_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: partial.chargeId,
            invoice: partial.invoiceId,
            amount: 2900,
            amount_refunded: 1450,
            currency: "eur",
            refunds: { data: [{ id: "re_bal_partial" }] },
          },
        },
      });
      await prisma.affiliateCommission.update({
        where: { id: partial.commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const remaining = (
        await prisma.affiliateCommission.findUnique({ where: { id: partial.commission.id } })
      )?.remaining_cents;
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThan(partial.commission.amount_cents);
      expect(
        await prisma.affiliateAdjustment.count({ where: { commission_id: partial.commission.id } })
      ).toBe(0);

      const admin = await founderAdmin();
      const detail = await adminDetail(admin.sessionId, partial.affiliate.id);
      expect(detail.pendingCents).toBe(0);
      expect(detail.payableCents).toBe(remaining);
      expect(detail.adjustmentCents).toBe(0);
      expect(detail.currentPayableBalanceCents).toBe(remaining);
    });

    it("refuses mark as paid when amountCents ignores omitted open clawbacks", async () => {
      const { affiliate, next, admin } = await paidThenClawback();
      const ignored = await markPaid(admin.sessionId, affiliate.id, {
        commissionIds: [next.id],
        amountCents: 10000,
      });
      expect(ignored.statusCode).toBe(400);
      expect(JSON.parse(ignored.body).code).toBe("amount_mismatch");
      expect(await prisma.affiliatePayout.count({ where: { affiliate_id: affiliate.id } })).toBe(1);
      expect(
        await prisma.affiliateAdjustment.count({
          where: { affiliate_id: affiliate.id, payout_id: null },
        })
      ).toBe(1);
    });

    it("auto-includes omitted open clawbacks when amountCents is the net payable", async () => {
      const { affiliate, next, admin } = await paidThenClawback();
      const paid = await markPaid(admin.sessionId, affiliate.id, {
        commissionIds: [next.id],
        amountCents: 5000,
      });
      expect(paid.statusCode).toBe(200);
      const payoutId = JSON.parse(paid.body).payoutId as string;
      const clawback = await prisma.affiliateAdjustment.findFirst({
        where: { affiliate_id: affiliate.id, reason: "refund" },
      });
      expect(clawback?.payout_id).toBe(payoutId);
      expect(await prisma.affiliatePayout.count({ where: { affiliate_id: affiliate.id } })).toBe(2);
    });

    it("records a negative adjustment for dispute-lost after payout and reduces balance", async () => {
      const { affiliate, commission, orgId } = await pendingCommission(16667);
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const extra = await seedPayableCommission(affiliate.id, orgId, 10000);
      const admin = await founderAdmin();
      const paid = await markPaid(admin.sessionId, affiliate.id, {
        commissionIds: [commission.id],
        amountCents: commission.remaining_cents,
      });
      expect(paid.statusCode).toBe(200);

      const before = await adminDetail(admin.sessionId, affiliate.id);
      expect(before.payableCents).toBe(extra.remaining_cents);
      expect(before.currentPayableBalanceCents).toBe(extra.remaining_cents);

      mockChargesRetrieve.mockResolvedValue({
        id: commission.stripe_charge_id,
        invoice: commission.stripe_invoice_id,
      });
      await postStripeEvent({
        id: `evt_dsp_paid_lost_${Date.now()}`,
        type: "charge.dispute.closed",
        data: {
          object: {
            id: `dp_paid_lost_${Date.now()}`,
            charge: commission.stripe_charge_id,
            amount: 16667,
            currency: "eur",
            reason: "fraudulent",
            status: "lost",
            livemode: false,
          },
        },
      });

      const stillPaid = await prisma.affiliateCommission.findUnique({
        where: { id: commission.id },
      });
      expect(stillPaid?.state).toBe("paid");
      const adjustment = await prisma.affiliateAdjustment.findFirst({
        where: { commission_id: commission.id, reason: "dispute_lost" },
      });
      expect(adjustment?.amount_cents).toBe(-commission.amount_cents);
      const after = await adminDetail(admin.sessionId, affiliate.id);
      expect(after.payableCents).toBe(extra.remaining_cents);
      expect(after.adjustmentCents).toBe(-commission.amount_cents);
      expect(after.currentPayableBalanceCents).toBe(
        extra.remaining_cents - commission.amount_cents
      );
    });

    it("refuses a concurrent second mark-as-paid without an idempotency key (no phantom payout)", async () => {
      const { affiliate, commission } = await pendingCommission(16667);
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const admin = await founderAdmin();
      const payload = {
        commissionIds: [commission.id],
        amountCents: commission.remaining_cents,
      };
      const [first, second] = await Promise.all([
        markPaid(admin.sessionId, affiliate.id, payload),
        markPaid(admin.sessionId, affiliate.id, payload),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const refused = first.statusCode === 409 ? first : second;
      expect(JSON.parse(refused.body).code).toBe("already_paid");
      expect(await prisma.affiliatePayout.count({ where: { affiliate_id: affiliate.id } })).toBe(1);
      expect(
        (await prisma.affiliateCommission.findUnique({ where: { id: commission.id } }))?.state
      ).toBe("paid");
    });

    it("links basil invoice.paid to refunds/disputes via payment_intent (no invoice.charge / charge.invoice)", async () => {
      const affiliate = await createAffiliate({ code: `basil-${Date.now()}` });
      const { sessionId } = await registerUser({
        email: `basil${Date.now()}@example.com`,
        referralCode: affiliate.code,
      });
      const orgId = await createOrg(sessionId);
      const customerId = `cus_basil_${orgId.slice(0, 8)}`;
      const invoiceId = `in_basil_${Date.now()}`;
      const paymentIntentId = `pi_basil_${Date.now()}`;
      const chargeId = `ch_basil_${Date.now()}`;
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          plan_tier: "PRO",
          stripe_customer_id: customerId,
          stripe_subscription_id: `sub_basil_${orgId.slice(0, 8)}`,
        },
      });
      await paidInvoice({
        orgId,
        invoiceId,
        amountPaid: 2900,
        customerId,
        basil: true,
        paymentIntentId,
      });
      const commission = await prisma.affiliateCommission.findUnique({
        where: { stripe_invoice_id: invoiceId },
      });
      expect(commission?.stripe_charge_id).toBeNull();
      expect(commission?.stripe_payment_intent_id).toBe(paymentIntentId);
      testCommissionIds.push(commission!.id);

      await postStripeEvent({
        id: `evt_basil_ref_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: chargeId,
            payment_intent: paymentIntentId,
            amount: 2900,
            amount_refunded: 1450,
            currency: "eur",
            customer: customerId,
            refunds: { data: [{ id: "re_basil" }] },
          },
        },
      });
      const reduced = await prisma.affiliateCommission.findUnique({ where: { id: commission!.id } });
      expect(reduced?.remaining_cents).toBe(435);
      expect(reduced?.state).toBe("pending");

      const lostInvoice = `in_basil_dsp_${Date.now()}`;
      const lostPi = `pi_basil_dsp_${Date.now()}`;
      const lostCharge = `ch_basil_dsp_${Date.now()}`;
      await paidInvoice({
        orgId,
        invoiceId: lostInvoice,
        amountPaid: 2900,
        customerId,
        basil: true,
        paymentIntentId: lostPi,
      });
      const lostCommission = await prisma.affiliateCommission.findUnique({
        where: { stripe_invoice_id: lostInvoice },
      });
      testCommissionIds.push(lostCommission!.id);
      mockChargesRetrieve.mockResolvedValue({
        id: lostCharge,
        customer: customerId,
        payment_intent: lostPi,
      });
      await postStripeEvent({
        id: `evt_basil_dsp_${Date.now()}`,
        type: "charge.dispute.closed",
        data: {
          object: {
            id: `dp_basil_${Date.now()}`,
            charge: lostCharge,
            payment_intent: lostPi,
            amount: 2900,
            currency: "eur",
            reason: "fraudulent",
            status: "lost",
            livemode: false,
          },
        },
      });
      expect(
        (await prisma.affiliateCommission.findUnique({ where: { id: lostCommission!.id } }))?.state
      ).toBe("voided");
    });

    it("lists invoicePayments when a basil invoice.paid payload omits payments", async () => {
      const { orgId } = await pendingCommission(2900);
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripe_customer_id: true, stripe_subscription_id: true },
      });
      const invoiceId = `in_basil_list_${Date.now()}`;
      const paymentIntentId = `pi_basil_list_${Date.now()}`;
      mockInvoicePaymentsList.mockResolvedValue({
        data: [
          {
            status: "paid",
            payment: { type: "payment_intent", payment_intent: paymentIntentId },
          },
        ],
      });
      await postStripeEvent({
        id: `evt_${invoiceId}`,
        type: "invoice.paid",
        data: {
          object: {
            id: invoiceId,
            amount_paid: 2900,
            tax: 0,
            currency: "eur",
            customer: org?.stripe_customer_id,
            billing_reason: "subscription_cycle",
            parent: {
              subscription_details: { subscription: org?.stripe_subscription_id },
            },
            status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
          },
        },
      });
      const created = await prisma.affiliateCommission.findUnique({
        where: { stripe_invoice_id: invoiceId },
      });
      expect(created?.stripe_payment_intent_id).toBe(paymentIntentId);
      testCommissionIds.push(created!.id);
    });

    it("flags needs_attention when a referred customer refund has no matching commission", async () => {
      const { orgId, customerId, affiliate } = await pendingCommission(2900);
      expect(affiliate.id).toBeTruthy();
      await postStripeEvent({
        id: `evt_unmatched_ref_${Date.now()}`,
        type: "charge.refunded",
        data: {
          object: {
            id: `ch_unmatched_${Date.now()}`,
            payment_intent: `pi_unmatched_${Date.now()}`,
            amount: 2900,
            amount_refunded: 2900,
            currency: "eur",
            customer: customerId,
            refunds: { data: [{ id: "re_unmatched" }] },
          },
        },
      });
      const referral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(referral?.needs_attention).toBe(true);
      expect(referral?.attention_reason).toContain(COMMISSION_NOT_FOUND_ATTENTION_REASON);
      const audit = await prisma.organizationAuditEvent.findFirst({
        where: { organization_id: orgId, action: "affiliate.commission.not_found" },
      });
      expect(audit).toBeTruthy();
    });

    it("claws only the paid remaining after a pre-payout partial refund, then a post-payout refund", async () => {
      const { affiliate, commission, chargeId, invoiceId } = await pendingCommission(16667);
      await applyRefundToCommission(prisma, {
        invoiceId,
        chargeId,
        chargeAmount: 16667,
        amountRefunded: 8334,
        currency: "eur",
      });
      const reduced = await prisma.affiliateCommission.findUnique({ where: { id: commission.id } });
      expect(reduced?.remaining_cents).toBeLessThan(commission.amount_cents);
      const paidRemaining = reduced!.remaining_cents;

      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const admin = await founderAdmin();
      const paid = await markPaid(admin.sessionId, affiliate.id, {
        commissionIds: [commission.id],
        amountCents: paidRemaining,
      });
      expect(paid.statusCode).toBe(200);

      const detail = await adminDetail(admin.sessionId, affiliate.id);
      expect(detail.paidCents).toBe(paidRemaining);

      await applyRefundToCommission(prisma, {
        invoiceId,
        chargeId,
        chargeAmount: 16667,
        amountRefunded: 16667,
        currency: "eur",
        refundId: "re_after_partial",
      });
      const clawbacks = await prisma.affiliateAdjustment.findMany({
        where: { commission_id: commission.id, reason: "refund" },
      });
      expect(clawbacks).toHaveLength(1);
      expect(clawbacks[0]?.amount_cents).toBe(-paidRemaining);
      const stillPaid = await prisma.affiliateCommission.findUnique({
        where: { id: commission.id },
      });
      expect(stillPaid?.state).toBe("paid");
      expect(stillPaid?.remaining_cents).toBe(paidRemaining);
    });

    it("does not re-claw the original amount after a clawback has been settled", async () => {
      const { affiliate, commission, orgId, chargeId, invoiceId } = await pendingCommission(16667);
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const admin = await founderAdmin();
      expect(
        (
          await markPaid(admin.sessionId, affiliate.id, {
            commissionIds: [commission.id],
            amountCents: commission.remaining_cents,
          })
        ).statusCode
      ).toBe(200);

      await applyRefundToCommission(prisma, {
        invoiceId,
        chargeId,
        chargeAmount: 16667,
        amountRefunded: 8334,
        currency: "eur",
        refundId: "re_settle_1",
      });
      const first = await prisma.affiliateAdjustment.findFirst({
        where: { commission_id: commission.id, reason: "refund" },
      });
      expect(first?.amount_cents).toBeLessThan(0);
      const firstClaw = Math.abs(first!.amount_cents);

      const next = await seedPayableCommission(affiliate.id, orgId, 10000);
      const net = 10000 - firstClaw;
      expect(
        (
          await markPaid(admin.sessionId, affiliate.id, {
            commissionIds: [next.id],
            amountCents: net,
          })
        ).statusCode
      ).toBe(200);
      expect(
        (await prisma.affiliateAdjustment.findUnique({ where: { id: first!.id } }))?.payout_id
      ).toBeTruthy();

      await applyRefundToCommission(prisma, {
        invoiceId,
        chargeId,
        chargeAmount: 16667,
        amountRefunded: 16667,
        currency: "eur",
        refundId: "re_settle_2",
      });
      const all = await prisma.affiliateAdjustment.findMany({
        where: { commission_id: commission.id, reason: "refund" },
      });
      const totalClawed = all.reduce((sum, row) => sum + Math.abs(row.amount_cents), 0);
      expect(totalClawed).toBe(commission.remaining_cents);
      expect(all).toHaveLength(2);
      expect(all.some((row) => Math.abs(row.amount_cents) === commission.amount_cents)).toBe(false);
    });

    it("claws only what was paid when a dispute is lost after a pre-payout partial refund", async () => {
      const { affiliate, commission, chargeId, invoiceId } = await pendingCommission(16667);
      await applyRefundToCommission(prisma, {
        invoiceId,
        chargeId,
        chargeAmount: 16667,
        amountRefunded: 8334,
        currency: "eur",
      });
      const paidRemaining = (
        await prisma.affiliateCommission.findUnique({ where: { id: commission.id } })
      )!.remaining_cents;
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const admin = await founderAdmin();
      expect(
        (
          await markPaid(admin.sessionId, affiliate.id, {
            commissionIds: [commission.id],
            amountCents: paidRemaining,
          })
        ).statusCode
      ).toBe(200);

      await applyDisputeToCommission(prisma, {
        invoiceId,
        chargeId,
        status: "lost",
        currency: "eur",
      });
      const adjustment = await prisma.affiliateAdjustment.findFirst({
        where: { commission_id: commission.id, reason: "dispute_lost" },
      });
      expect(adjustment?.amount_cents).toBe(-paidRemaining);
      expect(adjustment?.amount_cents).not.toBe(-commission.amount_cents);
    });

    it("serializes refund vs mark-as-paid so there is no overpay and no lost clawback", async () => {
      const { affiliate, commission, chargeId, invoiceId } = await pendingCommission(16667);
      await prisma.affiliateCommission.update({
        where: { id: commission.id },
        data: { payable_at: new Date(Date.now() - 1000) },
      });
      const originalRemaining = commission.remaining_cents;
      const admin = await registerUser({
        email: `founder-race-${Date.now()}@example.com`,
      });
      process.env.AFFILIATE_ADMIN_EMAILS = admin.user.email;

      const [refundResult, payoutResult] = await Promise.all([
        applyRefundToCommission(prisma, {
          invoiceId,
          chargeId,
          chargeAmount: 16667,
          amountRefunded: 16667,
          currency: "eur",
          refundId: `re_race_${Date.now()}`,
        }),
        markAffiliatePayoutPaid(prisma, {
          affiliateId: affiliate.id,
          actorUserId: admin.user.id,
          commissionIds: [commission.id],
          amountCents: originalRemaining,
        }),
      ]);

      const latest = await prisma.affiliateCommission.findUnique({
        where: { id: commission.id },
      });
      const payouts = await prisma.affiliatePayout.findMany({
        where: { affiliate_id: affiliate.id },
      });
      const clawbacks = await prisma.affiliateAdjustment.findMany({
        where: { commission_id: commission.id },
      });

      expect(payouts.length).toBeLessThanOrEqual(1);
      if (latest?.state === "paid") {
        expect(latest.remaining_cents).toBe(originalRemaining);
        expect(clawbacks.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(-originalRemaining);
        expect(payouts).toHaveLength(1);
        expect(payoutResult.kind === "paid" || refundResult.kind === "adjusted").toBe(true);
      } else {
        expect(latest?.state).toBe("voided");
        expect(latest?.remaining_cents).toBe(0);
        expect(payouts).toHaveLength(0);
        expect(clawbacks).toHaveLength(0);
        expect(refundResult.kind).toBe("voided");
        expect(payoutResult.kind).toBe("refused");
      }
    });
  });

  describe("feature flag OFF", () => {
    it("preserves existing signup and billing behavior", async () => {
      const previous = process.env.AFFILIATES_ENABLED;
      process.env.AFFILIATES_ENABLED = "false";
      try {
        const { user, sessionId } = await registerUser({
          email: `flagoff${Date.now()}@example.com`,
          referralCode: "alice",
        });
        expect(await prisma.userReferral.findUnique({ where: { user_id: user.id } })).toBeNull();
        const orgId = await createOrg(sessionId, "Flag Off Org");
        expect(
          await prisma.organizationReferral.findUnique({ where: { organization_id: orgId } })
        ).toBeNull();
        const checkout = await app.inject({
          method: "POST",
          url: `/api/meta/organizations/${orgId}/billing/checkout`,
          headers: { cookie: `telemetry_session=${sessionId}` },
          payload: { planTier: "PRO" },
        });
        expect(checkout.statusCode).toBe(200);
        expect(capturedCheckoutArgs?.metadata?.tt_org_id).toBeUndefined();
        expect(capturedCheckoutArgs?.metadata?.referral).toBeUndefined();
        const invoice = await paidInvoice({
          orgId,
          invoiceId: `in_flagoff_${Date.now()}`,
          amountPaid: 2900,
        });
        expect(invoice.statusCode).toBe(200);
        expect(await prisma.affiliateCommission.count({ where: { organization_id: orgId } })).toBe(0);
        expect(await prisma.webhookEvent.count({ where: { event_id: { startsWith: "evt_in_flagoff_" } } })).toBe(
          0
        );
      } finally {
        process.env.AFFILIATES_ENABLED = previous;
      }
    });
  });

  describe("founder admin", () => {
    it("creates an affiliate and resolves a payout hold", async () => {
      const adminEmail = `founder-admin-${Date.now()}@example.com`;
      process.env.AFFILIATE_ADMIN_EMAILS = adminEmail;
      const admin = await registerUser({ email: adminEmail });
      const created = await app.inject({
        method: "POST",
        url: "/api/meta/affiliates",
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { name: "Alice", email: "alice-aff@example.com", code: `alice-${Date.now()}` },
      });
      expect(created.statusCode).toBe(201);
      const { id, code } = JSON.parse(created.body) as { id: string; code: string };
      testAffiliateIds.push(id);

      const { sessionId } = await registerUser({
        email: `hold-${Date.now()}@example.com`,
        referralCode: code,
      });
      await prisma.affiliate.update({
        where: { id },
        data: { email_normalized: null },
      });
      const orgId = await createOrg(sessionId, "Hold Org");
      await prisma.organizationReferral.update({
        where: { organization_id: orgId },
        data: { needs_attention: true, attention_reason: "affiliate_email_unknown" },
      });
      const resolve = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/organizations/${orgId}/resolve-needs-attention`,
        headers: { cookie: `telemetry_session=${admin.sessionId}` },
        payload: { reason: "Verified offline" },
      });
      expect(resolve.statusCode).toBe(200);
      const referral = await prisma.organizationReferral.findUnique({
        where: { organization_id: orgId },
      });
      expect(referral?.needs_attention).toBe(false);
      expect(referral?.status).toBe("ACTIVE");
    });
  });
});
