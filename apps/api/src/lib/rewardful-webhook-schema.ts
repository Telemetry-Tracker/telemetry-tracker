/**
 * Rewardful webhook event schemas with per-event-type validation
 */
import { z } from "zod";

// Base event structure
const baseEventSchema = z.object({
  id: z.string(),
  created: z.string(), // ISO 8601
  type: z.string(),
  object: z.unknown(), // Per-event-type schemas below
});

// Commission event
const commissionSchema = z.object({
  id: z.string(),
  created: z.string(),
  amount: z.number(),
  currency: z.string(),
  state: z.string(),
  due_at: z.string().nullable(),
  voided_at: z.string().nullable(),
  affiliate: z.object({
    id: z.string(),
  }).passthrough(),
  sale: z.object({
    stripe_charge_id: z.string().nullable(),
    stripe_customer_id: z.string().nullable(),
  }).passthrough().nullable(),
}).passthrough();

export const rewardfulCommissionCreatedSchema = baseEventSchema.extend({
  type: z.literal("commission.created"),
  object: commissionSchema,
});

export const rewardfulCommissionUpdatedSchema = baseEventSchema.extend({
  type: z.literal("commission.updated"),
  object: commissionSchema,
});

// Referral event
const referralSchema = z.object({
  id: z.string(),
  created: z.string(),
  state: z.string(),
  lead: z.string().nullable(),
  converted: z.string().nullable(),
  affiliate: z.object({
    id: z.string(),
    stripe_customer_id: z.string().nullable(),
  }).passthrough(),
}).passthrough();

export const rewardfulReferralCreatedSchema = baseEventSchema.extend({
  type: z.literal("referral.created"),
  object: referralSchema,
});

export const rewardfulReferralUpdatedSchema = baseEventSchema.extend({
  type: z.literal("referral.updated"),
  object: referralSchema,
});

// Union of all event types
export const rewardfulWebhookEventSchema = z.discriminatedUnion("type", [
  rewardfulCommissionCreatedSchema,
  rewardfulCommissionUpdatedSchema,
  rewardfulReferralCreatedSchema,
  rewardfulReferralUpdatedSchema,
]);

export type RewardfulWebhookEvent = z.infer<typeof rewardfulWebhookEventSchema>;
export type RewardfulCommission = z.infer<typeof commissionSchema>;
export type RewardfulReferral = z.infer<typeof referralSchema>;
