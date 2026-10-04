/**
 * Webhook event deduplication for Stripe and Rewardful.
 * Ensures idempotent processing of webhook events by provider-scoped event IDs.
 */
import type { PrismaClient } from "@prisma/client";

export type WebhookProvider = "stripe" | "rewardful";

export type WebhookDedupeResult =
  | { kind: "first_delivery"; id: string }
  | { kind: "duplicate" };

/**
 * Check if webhook event has been processed successfully. If first delivery or previous failure, allow processing.
 * Returns "first_delivery" with the created WebhookEvent ID, or "duplicate" if already successfully processed.
 *
 * CRITICAL: Only events with processed_at set are considered duplicates. Failed events (error set but not processed_at)
 * are deleted so Stripe/Rewardful retry can reprocess them.
 *
 * Usage:
 * ```
 * const result = await dedupeWebhookEvent(prisma, "stripe", event.id, event.type);
 * if (result.kind === "duplicate") {
 *   return reply.send({ received: true }); // Already successfully processed
 * }
 * try {
 *   // Process event...
 *   await markWebhookProcessed(prisma, result.id);
 * } catch (err) {
 *   await markWebhookFailed(prisma, result.id, String(err));
 *   throw err; // Let provider retry
 * }
 * ```
 */
export async function dedupeWebhookEvent(
  prisma: PrismaClient,
  provider: WebhookProvider,
  eventId: string,
  eventType?: string
): Promise<WebhookDedupeResult> {
  try {
    // Check if event already exists and was successfully processed
    const existing = await prisma.webhookEvent.findUnique({
      where: {
        provider_event_id: {
          provider,
          event_id: eventId,
        },
      },
      select: { id: true, processed_at: true, error: true },
    });

    if (existing) {
      if (existing.processed_at && !existing.error) {
        // Successfully processed - this is a duplicate
        return { kind: "duplicate" };
      } else {
        // Previous attempt failed - delete and allow retry
        await prisma.webhookEvent.delete({
          where: {
            provider_event_id: {
              provider,
              event_id: eventId,
            },
          },
        });
      }
    }

    // Create new record for this delivery attempt
    const created = await prisma.webhookEvent.create({
      data: {
        provider,
        event_id: eventId,
        event_type: eventType ?? null,
      },
      select: { id: true },
    });
    return { kind: "first_delivery", id: created.id };
  } catch (err) {
    // Other errors (DB down, concurrent insert race, etc.)
    // Log and treat as first delivery (at-least-once semantics)
    console.warn(
      { provider, eventId, err },
      "Webhook dedupe check failed; treating as first delivery"
    );
    return { kind: "first_delivery", id: "unknown" };
  }
}

/**
 * Mark webhook event as successfully processed.
 */
export async function markWebhookProcessed(
  prisma: PrismaClient,
  webhookEventId: string
): Promise<void> {
  if (webhookEventId === "unknown") {
    // Dedupe check failed; nothing to update
    return;
  }
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processed_at: new Date() },
  });
}

/**
 * Mark webhook event as failed with error message.
 */
export async function markWebhookFailed(
  prisma: PrismaClient,
  webhookEventId: string,
  error: string
): Promise<void> {
  if (webhookEventId === "unknown") {
    return;
  }
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      processed_at: new Date(),
      error: error.slice(0, 1000), // Cap error message length
    },
  });
}
