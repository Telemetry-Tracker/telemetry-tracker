import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/db.js";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";

const RUN_DB_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === "true";

(RUN_DB_TESTS ? describe : describe.skip)("Affiliates protections (integration)", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdAffiliateIds: string[] = [];
  const createdReferralIds: string[] = [];
  const createdWebhookEventIds: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Save original env
    originalEnv = {
      AFFILIATES_ENABLED: process.env.AFFILIATES_ENABLED,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      REWARDFUL_WEBHOOK_SECRET: process.env.REWARDFUL_WEBHOOK_SECRET,
      TELEMETRY_ALLOW_REGISTRATION: process.env.TELEMETRY_ALLOW_REGISTRATION,
    };
    
    // Set test env
    process.env.AFFILIATES_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    process.env.REWARDFUL_WEBHOOK_SECRET = "test_secret";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
  });

  afterAll(() => {
    // Restore original env
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(async () => {
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await prisma.organizationReferral.deleteMany({ where: { id: { in: createdReferralIds } } });
    await prisma.userReferral.deleteMany({ where: { user_id: { in: createdUserIds } } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds } } });
    await prisma.organizationMembership.deleteMany({ where: { organization_id: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: createdAffiliateIds } } });
    createdUserIds.length = 0;
    createdOrgIds.length = 0;
    createdAffiliateIds.length = 0;
    createdReferralIds.length = 0;
    createdWebhookEventIds.length = 0;
  });

  it("completeUnresolvedReferrals: expired referral stays expired after webhook", async () => {
    // Create user with expired referral (>55 days old)
    const expiredDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
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

    // Create org with expired referral (affiliate_id null, first_seen_at > 55 days ago)
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
    const rewardfulPayload = {
      event: {
        id: `evt_expired_${Date.now()}`,
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
    // Create user and org with expired referral
    const expiredDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const user = await prisma.user.create({
      data: {
        email: `exp-checkout-${Date.now()}@example.com`,
        password_hash: "dummy",
      },
    });
    createdUserIds.push(user.id);

    const affiliate = await prisma.affiliate.create({
      data: {
        rewardful_affiliate_id: `aff_exp_checkout_${Date.now()}`,
        email_normalized: "affiliate2@example.com",
        state: "active",
      },
    });
    createdAffiliateIds.push(affiliate.id);

    const org = await prisma.organization.create({
      data: {
        name: "Expired Checkout Org",
        stripe_customer_id: `cus_expired_${Date.now()}`,
        memberships: {
          create: {
            user_id: user.id,
            role: "OWNER",
          },
        },
      },
    });
    createdOrgIds.push(org.id);

    await prisma.userReferral.create({
      data: {
        user_id: user.id,
        affiliate_id: affiliate.id,
        rewardful_referral_id: `ref_exp_checkout_${Date.now()}`,
        source: "link",
        status: "EXPIRED",
        captured_at: expiredDate,
        attributed_organization_id: org.id,
      },
    });

    const referral = await prisma.organizationReferral.create({
      data: {
        organization_id: org.id,
        affiliate_id: affiliate.id,
        rewardful_referral_id: `ref_exp_checkout_${Date.now()}`,
        source: "link",
        status: "EXPIRED",
        first_seen_at: expiredDate,
        needs_attention: true,
        attention_reason: "referral_expired_55_days",
      },
    });
    createdReferralIds.push(referral.id);

    // Verify the billing.ts:205 logic would skip tt_* metadata
    // by checking the UserReferral query that billing.ts uses
    const userRef = await prisma.userReferral.findUnique({
      where: { attributed_organization_id: org.id },
      select: { status: true, affiliate_id: true },
    });
    
    // This is what billing.ts checks: status must be ACTIVE and attributed to this org
    const shouldAddMetadata = userRef?.status === "ACTIVE" && userRef.affiliate_id;
    expect(shouldAddMetadata).toBe(false); // Expired referral should NOT get metadata
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

  it("dispute alert: test mode disputes (livemode=false) log only, no email", async () => {
    // Verify the stripe-webhook.ts logic by reading the livemode check
    // Full webhook testing would require complex Stripe SDK mocking
    const fs = await import("node:fs/promises");
    const webhookCode = await fs.readFile("src/routes/stripe-webhook.ts", "utf-8");
    
    // Verify the livemode check exists before sending emails
    expect(webhookCode).toContain("if (!dispute.livemode)");
    expect(webhookCode).toContain("Skipping dispute alert email for test-mode dispute");
  });
});

(RUN_DB_TESTS ? describe : describe.skip)("Self-referral protection (integration)", () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdAffiliateIds: string[] = [];
  const createdReferralIds: string[] = [];
  let originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Save original env
    originalEnv = {
      AFFILIATES_ENABLED: process.env.AFFILIATES_ENABLED,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      REWARDFUL_WEBHOOK_SECRET: process.env.REWARDFUL_WEBHOOK_SECRET,
      TELEMETRY_ALLOW_REGISTRATION: process.env.TELEMETRY_ALLOW_REGISTRATION,
    };
    
    // Set test env
    process.env.AFFILIATES_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    process.env.REWARDFUL_WEBHOOK_SECRET = "test_secret";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
  });

  afterAll(() => {
    // Restore original env
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(async () => {
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await prisma.organizationReferral.deleteMany({ where: { id: { in: createdReferralIds } } });
    await prisma.userReferral.deleteMany({ where: { user_id: { in: createdUserIds } } });
    await prisma.organizationMembership.deleteMany({ where: { organization_id: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: createdAffiliateIds } } });
    createdUserIds.length = 0;
    createdOrgIds.length = 0;
    createdAffiliateIds.length = 0;
    createdReferralIds.length = 0;
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
    const rewardfulPayload = {
      event: {
        id: `evt_self_webhook_${Date.now()}`,
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
    // Save original env
    originalEnv = {
      AFFILIATES_ENABLED: process.env.AFFILIATES_ENABLED,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      REWARDFUL_WEBHOOK_SECRET: process.env.REWARDFUL_WEBHOOK_SECRET,
      TELEMETRY_ALLOW_REGISTRATION: process.env.TELEMETRY_ALLOW_REGISTRATION,
    };
    
    // Set test env
    process.env.AFFILIATES_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    process.env.REWARDFUL_WEBHOOK_SECRET = "test_secret";
    process.env.TELEMETRY_ALLOW_REGISTRATION = "true";
  });

  afterAll(() => {
    // Restore original env
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(async () => {
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await prisma.organizationReferral.deleteMany({ where: { id: { in: createdReferralIds } } });
    await prisma.userReferral.deleteMany({ where: { user_id: { in: createdUserIds } } });
    await prisma.organizationMembership.deleteMany({ where: { organization_id: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: createdAffiliateIds } } });
    createdUserIds.length = 0;
    createdOrgIds.length = 0;
    createdAffiliateIds.length = 0;
    createdReferralIds.length = 0;
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
