import { describe, expect, it } from "vitest";
import {
  canWriteAffiliateTtMetadata,
  canWriteStripeReferralMetadata,
  isPayoutHold,
} from "./organization-attribution.js";

describe("isPayoutHold", () => {
  it("is true only for self-referral-risk reasons", () => {
    expect(isPayoutHold({ attention_reason: "affiliate_email_unknown" })).toBe(true);
    expect(
      isPayoutHold({
        attention_reason: "affiliate_email_unknown_cannot_verify_self_referral",
      })
    ).toBe(true);
    expect(
      isPayoutHold({
        attention_reason: "prior;affiliate_email_unknown_cannot_verify_self_referral",
      })
    ).toBe(true);
    expect(
      isPayoutHold({ attention_reason: "no_owner_found_for_self_referral_check" })
    ).toBe(true);
    expect(isPayoutHold({ attention_reason: "rejected_self_referral" })).toBe(true);
  });

  it("is false for unresolved, Stripe create failure, and expiry", () => {
    expect(isPayoutHold({ attention_reason: null })).toBe(false);
    expect(isPayoutHold({ attention_reason: "affiliate_unresolved" })).toBe(false);
    expect(isPayoutHold({ attention_reason: "customer_creation_failed" })).toBe(false);
    expect(isPayoutHold({ attention_reason: "referral_expired_60_days" })).toBe(false);
    expect(
      isPayoutHold({ attention_reason: "affiliate_unresolved;customer_creation_failed" })
    ).toBe(false);
  });
});

describe("Stripe referral metadata gates", () => {
  it("blocks referral and tt_* on a payout hold, not on needs_attention alone", () => {
    const emailUnknown = {
      status: "ACTIVE" as const,
      affiliate_id: "aff_1",
      needs_attention: true,
      attention_reason: "affiliate_email_unknown",
    };
    expect(canWriteStripeReferralMetadata(emailUnknown)).toBe(false);
    expect(canWriteAffiliateTtMetadata(emailUnknown)).toBe(false);

    const createFailed = {
      status: "UNRESOLVED" as const,
      affiliate_id: null,
      needs_attention: true,
      attention_reason: "customer_creation_failed",
    };
    expect(canWriteStripeReferralMetadata(createFailed)).toBe(true);
    expect(canWriteAffiliateTtMetadata(createFailed)).toBe(false);
  });

  it("allows referral metadata for ACTIVE|UNRESOLVED when not a payout hold", () => {
    expect(
      canWriteStripeReferralMetadata({
        status: "UNRESOLVED",
        affiliate_id: null,
        needs_attention: false,
        attention_reason: null,
      })
    ).toBe(true);
    expect(
      canWriteStripeReferralMetadata({
        status: "ACTIVE",
        affiliate_id: "aff_1",
        needs_attention: false,
        attention_reason: null,
      })
    ).toBe(true);
    expect(
      canWriteStripeReferralMetadata({
        status: "EXPIRED",
        affiliate_id: "aff_1",
        attention_reason: "referral_expired_60_days",
      })
    ).toBe(false);
    expect(
      canWriteStripeReferralMetadata({
        status: "REJECTED",
        affiliate_id: null,
        attention_reason: "rejected_self_referral",
      })
    ).toBe(false);
  });

  it("allows tt_* only for ACTIVE with affiliate_id and !payoutHold", () => {
    expect(
      canWriteAffiliateTtMetadata({
        status: "ACTIVE",
        affiliate_id: "aff_1",
        attention_reason: null,
      })
    ).toBe(true);
    expect(
      canWriteAffiliateTtMetadata({
        status: "UNRESOLVED",
        affiliate_id: "aff_1",
        attention_reason: null,
      })
    ).toBe(false);
    expect(
      canWriteAffiliateTtMetadata({
        status: "ACTIVE",
        affiliate_id: "aff_1",
        attention_reason: "affiliate_email_unknown",
      })
    ).toBe(false);
  });
});
