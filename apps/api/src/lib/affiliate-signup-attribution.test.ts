/**
 * Tests for affiliate signup attribution logic.
 * Covers valid/invalid referrals, self-referral checks, and Stripe Customer creation.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { attributeSignupToAffiliate } from "./affiliate-signup-attribution.js";
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

const mockPrisma = {
  affiliate: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  organizationReferral: {
    create: vi.fn(),
  },
  organization: {
    update: vi.fn(),
  },
} as unknown as PrismaClient;

const mockStripe = {
  customers: {
    create: vi.fn(),
  },
} as unknown as Stripe;

describe("attributeSignupToAffiliate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: feature enabled
    vi.stubEnv("AFFILIATES_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  });

  it("returns not_enabled when feature flag is OFF", async () => {
    vi.stubEnv("AFFILIATES_ENABLED", "false");

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
      rewardfulReferralId: "rwf_abc",
    });

    expect(result.kind).toBe("not_enabled");
  });

  it("returns no_referral when no referral data provided", async () => {
    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
    });

    expect(result.kind).toBe("no_referral");
  });

  it("returns no_referral for invalid UUID", async () => {
    (mockPrisma.affiliate.findFirst as Mock).mockResolvedValue(null);

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
      rewardfulReferralId: "not-a-uuid",
      viaToken: "invalid",
    });

    expect(result.kind).toBe("no_referral");
  });

  it("accepts valid referral and creates Stripe Customer", async () => {
    const affiliateId = "aff_456";
    (mockPrisma.affiliate.findFirst as Mock).mockResolvedValue({ id: affiliateId });
    (mockPrisma.affiliate.findUnique as Mock).mockResolvedValue({
      id: affiliateId,
      email_normalized: "affiliate@example.com",
    });
    (mockStripe.customers.create as Mock).mockResolvedValue({ id: "cus_test123" });
    (mockPrisma.organization.update as Mock).mockResolvedValue({});
    (mockPrisma.organizationReferral.create as Mock).mockResolvedValue({ id: "ref_789" });

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
      rewardfulReferralId: "550e8400-e29b-41d4-a716-446655440000",
      viaToken: "alice",
    });

    expect(result.kind).toBe("attributed");
    if (result.kind === "attributed") {
      expect(result.customerId).toBe("cus_test123");
      expect(result.referralId).toBe("ref_789");
    }
    expect(mockStripe.customers.create).toHaveBeenCalledWith({
      name: "Test Org",
      email: "user@example.com",
      metadata: {
        tt_org_id: "org_123",
        tt_affiliate_id: affiliateId,
        referral: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
  });

  it("rejects self-referral based on email normalization", async () => {
    const affiliateId = "aff_self";
    (mockPrisma.affiliate.findFirst as Mock).mockResolvedValue({ id: affiliateId });
    (mockPrisma.affiliate.findUnique as Mock).mockResolvedValue({
      id: affiliateId,
      email_normalized: "alice@gmail.com", // Normalized
    });

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "al.ice+tag@gmail.com", // Normalizes to alice@gmail.com
      viaToken: "alice",
    });

    expect(result.kind).toBe("rejected_self_referral");
    if (result.kind === "rejected_self_referral") {
      expect(result.reason).toContain("email matches affiliate");
    }
  });

  it("continues signup on Stripe Customer creation failure", async () => {
    const affiliateId = "aff_456";
    (mockPrisma.affiliate.findFirst as Mock).mockResolvedValue({ id: affiliateId });
    (mockPrisma.affiliate.findUnique as Mock).mockResolvedValue({
      id: affiliateId,
      email_normalized: "affiliate@example.com",
    });
    (mockStripe.customers.create as Mock).mockRejectedValue(new Error("Stripe API error"));

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
      rewardfulReferralId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error).toContain("Stripe API error");
    }
    // Organization should still be created (handled by caller)
  });

  it("resolves via token to affiliate", async () => {
    const affiliateId = "aff_token";
    (mockPrisma.affiliate.findFirst as Mock).mockResolvedValue({
      id: affiliateId,
    });
    (mockPrisma.affiliate.findUnique as Mock).mockResolvedValue({
      id: affiliateId,
      email_normalized: "affiliate@example.com",
    });
    (mockStripe.customers.create as Mock).mockResolvedValue({ id: "cus_via" });
    (mockPrisma.organization.update as Mock).mockResolvedValue({});
    (mockPrisma.organizationReferral.create as Mock).mockResolvedValue({ id: "ref_via" });

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
      viaToken: "bob",
    });

    expect(result.kind).toBe("attributed");
    expect(mockPrisma.affiliate.findFirst).toHaveBeenCalledWith({
      where: {
        link_token: "bob",
        state: "active",
      },
      select: { id: true },
    });
  });

  it("omits referral metadata when UUID is invalid but via token works", async () => {
    const affiliateId = "aff_token_only";
    (mockPrisma.affiliate.findFirst as Mock).mockResolvedValue({
      id: affiliateId,
    });
    (mockPrisma.affiliate.findUnique as Mock).mockResolvedValue({
      id: affiliateId,
      email_normalized: "affiliate@example.com",
    });
    (mockStripe.customers.create as Mock).mockResolvedValue({ id: "cus_no_uuid" });
    (mockPrisma.organization.update as Mock).mockResolvedValue({});
    (mockPrisma.organizationReferral.create as Mock).mockResolvedValue({ id: "ref_no_uuid" });

    const result = await attributeSignupToAffiliate(mockPrisma, mockStripe, {
      organizationId: "org_123",
      organizationName: "Test Org",
      userEmail: "user@example.com",
      rewardfulReferralId: "not-a-uuid",
      viaToken: "charlie",
    });

    expect(result.kind).toBe("attributed");
    expect(mockStripe.customers.create).toHaveBeenCalledWith({
      name: "Test Org",
      email: "user@example.com",
      metadata: {
        tt_org_id: "org_123",
        tt_affiliate_id: affiliateId,
        // No referral key since UUID was invalid
      },
    });
  });
});
