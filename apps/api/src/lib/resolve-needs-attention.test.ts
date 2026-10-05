import { describe, expect, it, vi } from "vitest";
import {
  AFFILIATE_RESOLVE_AUDIT_ACTION,
  resolveNeedsAttentionAsValid,
} from "./resolve-needs-attention.js";

function mockPrisma(opts: {
  stripeCustomerId: string | null;
  referral: {
    id: string;
    affiliate_id: string | null;
    status: string;
    needs_attention: boolean;
    attention_reason: string | null;
    rewardful_referral_id: string | null;
    via_token: string | null;
  } | null;
}) {
  return {
    organization: {
      findFirst: vi.fn().mockResolvedValue(
        opts.stripeCustomerId === undefined
          ? null
          : { id: "org_1", stripe_customer_id: opts.stripeCustomerId }
      ),
    },
    organizationReferral: {
      findUnique: vi.fn().mockResolvedValue(opts.referral),
      update: vi.fn().mockResolvedValue({}),
    },
    organizationAuditEvent: {
      create: vi.fn().mockResolvedValue({ id: "aud_1" }),
    },
  };
}

describe("resolveNeedsAttentionAsValid", () => {
  it("clears needs_attention without Stripe when no stripe_customer_id (checkout backfill later)", async () => {
    const prisma = mockPrisma({
      stripeCustomerId: null,
      referral: {
        id: "ref_1",
        affiliate_id: "aff_1",
        status: "ACTIVE",
        needs_attention: true,
        attention_reason: "affiliate_email_unknown",
        rewardful_referral_id: "00000000-0000-4000-8000-000000000001",
        via_token: null,
      },
    });
    const stripe = {
      customers: {
        retrieve: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    };

    const result = await resolveNeedsAttentionAsValid(
      prisma as never,
      stripe as never,
      {
        organizationId: "org_1",
        actorUserId: "user_admin",
        actorEmail: "founder@example.com",
        reason: "Verified affiliate email offline",
      }
    );

    expect(result).toMatchObject({
      kind: "resolved",
      idempotent: false,
      toStatus: "ACTIVE",
      stripe: "deferred",
      customerId: null,
    });
    expect(prisma.organizationReferral.update).toHaveBeenCalledWith({
      where: { id: "ref_1" },
      data: {
        needs_attention: false,
        attention_reason: null,
        status: "ACTIVE",
        created_by: "user_admin",
      },
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.customers.update).not.toHaveBeenCalled();
    expect(prisma.organizationAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AFFILIATE_RESOLVE_AUDIT_ACTION,
        actor_email: "founder@example.com",
        target: expect.stringContaining("stripe=deferred"),
      }),
    });
  });

  it("refuses REJECTED without writing Stripe or changing attribution", async () => {
    const prisma = mockPrisma({
      stripeCustomerId: "cus_existing",
      referral: {
        id: "ref_rej",
        affiliate_id: null,
        status: "REJECTED",
        needs_attention: true,
        attention_reason: "rejected_self_referral",
        rewardful_referral_id: "00000000-0000-4000-8000-000000000002",
        via_token: null,
      },
    });
    const stripe = {
      customers: { retrieve: vi.fn(), update: vi.fn(), create: vi.fn() },
    };

    const result = await resolveNeedsAttentionAsValid(
      prisma as never,
      stripe as never,
      {
        organizationId: "org_1",
        actorUserId: "user_admin",
        actorEmail: "founder@example.com",
        reason: "should not work",
      }
    );

    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.code).toBe("rejected");
    expect(prisma.organizationReferral.update).not.toHaveBeenCalled();
    expect(stripe.customers.update).not.toHaveBeenCalled();
    expect(prisma.organizationAuditEvent.create).not.toHaveBeenCalled();
  });

  it("refuses when confirmAffiliateId would change the canonical affiliate", async () => {
    const prisma = mockPrisma({
      stripeCustomerId: "cus_existing",
      referral: {
        id: "ref_1",
        affiliate_id: "aff_canonical",
        status: "ACTIVE",
        needs_attention: true,
        attention_reason: "affiliate_email_unknown",
        rewardful_referral_id: null,
        via_token: "alice",
      },
    });
    const stripe = {
      customers: { retrieve: vi.fn(), update: vi.fn(), create: vi.fn() },
    };

    const result = await resolveNeedsAttentionAsValid(
      prisma as never,
      stripe as never,
      {
        organizationId: "org_1",
        actorUserId: "user_admin",
        actorEmail: "founder@example.com",
        reason: "try to reassign",
        confirmAffiliateId: "00000000-0000-4000-8000-000000000099",
      }
    );

    expect(result).toMatchObject({ kind: "refused", code: "affiliate_mismatch" });
    expect(prisma.organizationReferral.update).not.toHaveBeenCalled();
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });
});
