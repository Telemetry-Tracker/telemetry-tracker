/**
 * Shared Stripe Customer tt_* metadata writes.
 * Never creates a Customer — callers must pass an existing customer id.
 * Does not write third-party referral tokens onto the Customer.
 */
import type Stripe from "stripe";
import { canWriteAffiliateTtMetadata } from "./organization-attribution.js";

export type ReferralCustomerMetadataInput = {
  status: string;
  affiliate_id: string | null;
  needs_attention?: boolean;
  attention_reason?: string | null;
};

export type CustomerReferralSyncResult =
  | "updated"
  | "unchanged"
  | "skipped_deleted"
  | "skipped_ineligible";

export function buildCustomerReferralMetadataPatch(
  orgId: string,
  referral: ReferralCustomerMetadataInput,
  existing: Record<string, string>
): { metadata: Record<string, string>; writeTt: boolean } {
  const metadata = { ...existing };
  const writeTt = canWriteAffiliateTtMetadata(referral);

  if (writeTt && referral.affiliate_id) {
    metadata.tt_org_id = orgId;
    metadata.tt_affiliate_id = referral.affiliate_id;
  }
  return { metadata, writeTt };
}

/**
 * Attach tt_* onto an existing Stripe Customer.
 * Does not call customers.create.
 */
export async function updateExistingCustomerReferralMetadata(
  stripe: Stripe,
  orgId: string,
  customerId: string,
  referral: ReferralCustomerMetadataInput
): Promise<CustomerReferralSyncResult> {
  const canWriteTt = canWriteAffiliateTtMetadata(referral);
  if (!canWriteTt) {
    return "skipped_ineligible";
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return "skipped_deleted";

  const existing = { ...(customer.metadata ?? {}) };
  const missingTt = !existing.tt_affiliate_id;
  if (!missingTt) {
    return "unchanged";
  }

  const { metadata } = buildCustomerReferralMetadataPatch(orgId, referral, existing);
  await stripe.customers.update(customerId, { metadata });
  return "updated";
}
