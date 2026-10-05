import { describe, expect, it } from "vitest";
import {
  canWriteAffiliateTtMetadata,
  canWriteStripeReferralMetadata,
} from "./organization-attribution.js";

describe("Stripe referral metadata gates", () => {
  it("blocks referral and tt_* when needs_attention", () => {
    const flaggedActive = {
      status: "ACTIVE",
      affiliate_id: "aff_1",
      needs_attention: true,
    };
    expect(canWriteStripeReferralMetadata(flaggedActive)).toBe(false);
    expect(canWriteAffiliateTtMetadata(flaggedActive)).toBe(false);

    const flaggedUnresolved = {
      status: "UNRESOLVED",
      affiliate_id: null,
      needs_attention: true,
    };
    expect(canWriteStripeReferralMetadata(flaggedUnresolved)).toBe(false);
    expect(canWriteAffiliateTtMetadata(flaggedUnresolved)).toBe(false);
  });

  it("allows referral metadata for ACTIVE|UNRESOLVED only when !needs_attention", () => {
    expect(
      canWriteStripeReferralMetadata({
        status: "ACTIVE",
        affiliate_id: "aff_1",
        needs_attention: false,
      })
    ).toBe(true);
    expect(
      canWriteStripeReferralMetadata({
        status: "UNRESOLVED",
        affiliate_id: null,
        needs_attention: false,
      })
    ).toBe(true);
    expect(
      canWriteStripeReferralMetadata({
        status: "EXPIRED",
        affiliate_id: "aff_1",
        needs_attention: false,
      })
    ).toBe(false);
    expect(
      canWriteStripeReferralMetadata({
        status: "REJECTED",
        affiliate_id: null,
        needs_attention: false,
      })
    ).toBe(false);
  });

  it("allows tt_* only for ACTIVE with affiliate_id and !needs_attention", () => {
    expect(
      canWriteAffiliateTtMetadata({
        status: "ACTIVE",
        affiliate_id: "aff_1",
        needs_attention: false,
      })
    ).toBe(true);
    expect(
      canWriteAffiliateTtMetadata({
        status: "UNRESOLVED",
        affiliate_id: "aff_1",
        needs_attention: false,
      })
    ).toBe(false);
    expect(
      canWriteAffiliateTtMetadata({
        status: "ACTIVE",
        affiliate_id: null,
        needs_attention: false,
      })
    ).toBe(false);
  });
});
