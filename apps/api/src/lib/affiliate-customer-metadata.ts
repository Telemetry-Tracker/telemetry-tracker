/**
 * Shared Stripe Customer referral metadata writes.
 * Never creates a Customer — callers must pass an existing customer id.
 */
import type Stripe from "stripe";
import {
  canWriteAffiliateTtMetadata,
  canWriteStripeReferralMetadata,
} from "./organization-attribution.js";

export type ReferralCustomerMetadataInput = {
  status: string;
  affiliate_id: string | null;
  needs_attention?: boolean;
  attention_reason?: string | null;
  rewardful_referral_id: string | null;
  via_token: string | null;
};

export type CustomerReferralSyncResult =
  | "updated"
  | "unchanged"
  | "skipped_deleted"
  | "skipped_ineligible";

function referralToken(referral: ReferralCustomerMetadataInput): string | undefined {
  if (referral.rewardful_referral_id) return referral.rewardful_referral_id;
  if (referral.via_token && referral.affiliate_id) return referral.via_token;
  return undefined;
}

export function buildCustomerReferralMetadataPatch(
  orgId: string,
  referral: ReferralCustomerMetadataInput,
  existing: Record<string, string>
): { metadata: Record<string, string>; writeReferral: boolean; writeTt: boolean } {
  const metadata = { ...existing };
  const writeReferral =
    canWriteStripeReferralMetadata(referral) && !!referralToken(referral);
  const writeTt = canWriteAffiliateTtMetadata(referral);

  if (writeTt && referral.affiliate_id) {
    metadata.tt_org_id = orgId;
    metadata.tt_affiliate_id = referral.affiliate_id;
  }
  if (writeReferral) {
    const token = referralToken(referral);
    if (token) metadata.referral = token;
  }
  return { metadata, writeReferral, writeTt };
}

/**
 * Attach referral / tt_* onto an existing Stripe Customer.
 * Does not call customers.create.
 */
export async function updateExistingCustomerReferralMetadata(
  stripe: Stripe,
  orgId: string,
  customerId: string,
  referral: ReferralCustomerMetadataInput
): Promise<CustomerReferralSyncResult> {
  const canWriteReferral =
    canWriteStripeReferralMetadata(referral) && !!referralToken(referral);
  const canWriteTt = canWriteAffiliateTtMetadata(referral);
  if (!canWriteReferral && !canWriteTt) {
    return "skipped_ineligible";
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return "skipped_deleted";

  const existing = { ...(customer.metadata ?? {}) };
  const missingReferral = canWriteReferral && !existing.referral;
  const missingTt = canWriteTt && !existing.tt_affiliate_id;
  if (!missingReferral && !missingTt) {
    return "unchanged";
  }

  const { metadata } = buildCustomerReferralMetadataPatch(orgId, referral, existing);
  await stripe.customers.update(customerId, { metadata });
  return "updated";
}
