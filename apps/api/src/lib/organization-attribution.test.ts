import { describe, expect, it } from "vitest";
import {
  canWriteAffiliateTtMetadata,
  isPayoutHold,
  isReferralExpired,
  REFERRAL_ATTRIBUTION_WINDOW_DAYS,
} from "./organization-attribution.js";

describe("isPayoutHold", () => {
  it("holds self-referral-risk reasons", () => {
    expect(isPayoutHold({ attention_reason: "affiliate_email_unknown" })).toBe(true);
    expect(
      isPayoutHold({ attention_reason: "affiliate_email_unknown_cannot_verify_self_referral" })
    ).toBe(true);
    expect(isPayoutHold({ attention_reason: "no_owner_found_for_self_referral_check" })).toBe(true);
    expect(isPayoutHold({ attention_reason: "rejected_self_referral" })).toBe(true);
    expect(
      isPayoutHold({ attention_reason: "customer_creation_failed;affiliate_email_unknown" })
    ).toBe(true);
  });

  it("does not hold billing-only or empty reasons", () => {
    expect(isPayoutHold({ attention_reason: null })).toBe(false);
    expect(isPayoutHold({ attention_reason: "customer_creation_failed" })).toBe(false);
    expect(isPayoutHold({ attention_reason: "affiliate_unresolved" })).toBe(false);
  });
});

describe("canWriteAffiliateTtMetadata", () => {
  it("writes only for ACTIVE resolved non-hold referrals", () => {
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
    expect(
      canWriteAffiliateTtMetadata({
        status: "EXPIRED",
        affiliate_id: "aff_1",
        attention_reason: "referral_expired_60_days",
      })
    ).toBe(false);
  });
});

describe("isReferralExpired", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");

  it("treats day 60 as still valid and day 61 as expired", () => {
    const day60 = new Date(now.getTime() - REFERRAL_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const day61 = new Date(
      now.getTime() - (REFERRAL_ATTRIBUTION_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    expect(isReferralExpired(day60, now)).toBe(false);
    expect(isReferralExpired(day61, now)).toBe(true);
  });
});
