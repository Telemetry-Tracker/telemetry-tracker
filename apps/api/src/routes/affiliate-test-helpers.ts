/**
 * Shared helpers for affiliate integration tests.
 * Not a test file — imported by affiliates*.integration.test.ts.
 */
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

export const AFFILIATE_TEST_ENV_KEYS = [
  "AFFILIATES_ENABLED",
  "STRIPE_SECRET_KEY",
  "REWARDFUL_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_BUSINESS",
  "TELEMETRY_DASHBOARD_ORIGIN",
  "TELEMETRY_ALLOW_REGISTRATION",
  "AFFILIATE_ADMIN_EMAILS",
] as const;

export const REWARDFUL_TEST_SECRET = "test_secret";
export const STRIPE_TEST_WEBHOOK_SECRET = "whsec_affiliate_tests";
export const STRIPE_PRICE_PRO_TEST = "price_test_pro";
export const STRIPE_PRICE_BUSINESS_TEST = "price_test_business";

export function snapshotEnv(
  keys: readonly string[] = AFFILIATE_TEST_ENV_KEYS
): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of keys) snap[key] = process.env[key];
  return snap;
}

export function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export function applyAffiliateTestEnv(overrides: Record<string, string> = {}): void {
  process.env.AFFILIATES_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_affiliate_mock";
  process.env.REWARDFUL_WEBHOOK_SECRET = REWARDFUL_TEST_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_TEST_WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = STRIPE_PRICE_PRO_TEST;
  process.env.STRIPE_PRICE_BUSINESS = STRIPE_PRICE_BUSINESS_TEST;
  process.env.TELEMETRY_DASHBOARD_ORIGIN = "https://test.example.com";
  process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
  process.env.AFFILIATE_ADMIN_EMAILS = "founder@example.com";
  Object.assign(process.env, overrides);
}

export function signRewardfulPayload(
  payload: unknown,
  secret: string = REWARDFUL_TEST_SECRET
): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

export function signStripeEvent(
  event: unknown,
  secret: string = STRIPE_TEST_WEBHOOK_SECRET
): { payload: string; header: string } {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return { payload, header: `t=${timestamp},v1=${signature}` };
}

export function uniqueReferralUuid(): string {
  return crypto.randomUUID();
}

export function normalizeCheckoutArgs(
  args: Stripe.Checkout.SessionCreateParams,
  orgId: string
): Stripe.Checkout.SessionCreateParams {
  const clone = structuredClone(args);
  if (clone.metadata?.organization_id === orgId) {
    clone.metadata.organization_id = "<org>";
  }
  if (clone.metadata?.tt_org_id === orgId) {
    clone.metadata.tt_org_id = "<org>";
  }
  if (clone.subscription_data?.metadata?.organization_id === orgId) {
    clone.subscription_data.metadata.organization_id = "<org>";
  }
  if (clone.subscription_data?.metadata?.tt_org_id === orgId) {
    clone.subscription_data.metadata.tt_org_id = "<org>";
  }
  if (typeof clone.customer === "string") {
    clone.customer = "<customer>";
  }
  return clone;
}

export type AffiliateFixtureIds = {
  userIds: string[];
  orgIds: string[];
  affiliateIds: string[];
  referralIds?: string[];
  webhookEventIds?: string[];
  webhookEventKeys?: string[];
  commissionIds?: string[];
  emails?: string[];
};

export async function cleanupAffiliateFixtures(
  prisma: PrismaClient,
  ids: AffiliateFixtureIds
): Promise<void> {
  const userIds = [...ids.userIds];
  const orgIds = [...ids.orgIds];
  const affiliateIds = [...ids.affiliateIds];
  const referralIds = ids.referralIds ?? [];
  const webhookEventIds = ids.webhookEventIds ?? [];
  const webhookEventKeys = ids.webhookEventKeys ?? [];
  const commissionIds = ids.commissionIds ?? [];
  const emails = ids.emails ?? [];

  if (commissionIds.length > 0) {
    await prisma.affiliateCommission.deleteMany({
      where: {
        OR: [
          { id: { in: commissionIds } },
          { rewardful_commission_id: { in: commissionIds } },
        ],
      },
    });
  }
  if (affiliateIds.length > 0) {
    await prisma.affiliateCommission.deleteMany({
      where: { affiliate_id: { in: affiliateIds } },
    });
  }
  if (orgIds.length > 0) {
    await prisma.affiliateCommission.deleteMany({
      where: { organization_id: { in: orgIds } },
    });
    await prisma.organizationReferral.deleteMany({
      where: { organization_id: { in: orgIds } },
    });
    await prisma.userReferral.deleteMany({
      where: { attributed_organization_id: { in: orgIds } },
    });
    await prisma.organizationAuditEvent.deleteMany({
      where: { organization_id: { in: orgIds } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organization_id: { in: orgIds } },
    });
  }
  if (referralIds.length > 0) {
    await prisma.organizationReferral.deleteMany({ where: { id: { in: referralIds } } });
  }
  if (userIds.length > 0) {
    await prisma.userReferral.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { user_id: { in: userIds } } });
  }
  if (emails.length > 0) {
    const emailUsers = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const extraUserIds = emailUsers.map((u) => u.id);
    if (extraUserIds.length > 0) {
      await prisma.userReferral.deleteMany({ where: { user_id: { in: extraUserIds } } });
      await prisma.userSession.deleteMany({ where: { user_id: { in: extraUserIds } } });
      userIds.push(...extraUserIds);
    }
  }
  if (orgIds.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (affiliateIds.length > 0) {
    await prisma.userReferral.deleteMany({ where: { affiliate_id: { in: affiliateIds } } });
    await prisma.organizationReferral.deleteMany({
      where: { affiliate_id: { in: affiliateIds } },
    });
    await prisma.affiliate.deleteMany({ where: { id: { in: affiliateIds } } });
  }
  if (webhookEventIds.length > 0) {
    await prisma.webhookEvent.deleteMany({ where: { id: { in: webhookEventIds } } });
  }
  if (webhookEventKeys.length > 0) {
    await prisma.webhookEvent.deleteMany({ where: { event_id: { in: webhookEventKeys } } });
  }
}
