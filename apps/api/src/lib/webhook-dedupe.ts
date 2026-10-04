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
 * Check if webhook event has been processed. If first delivery, record it.
 * Returns "first_delivery" with the created WebhookEvent ID, or "duplicate" if already seen.
 *
 * Usage:
 * ```
 * const result = await dedupeWebhookEvent(prisma, "stripe", event.id, event.type);
 * if (result.kind === "duplicate") {
 *   return reply.send({ received: true }); // Already processed
 * }
 * // Process event...
 * await markWebhookProcessed(prisma, result.id);
 * ```
 */
export async function dedupeWebhookEvent(
  prisma: PrismaClient,
  provider: WebhookProvider,
  eventId: string,
  eventType?: string
): Promise<WebhookDedupeResult> {
  try {
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
    // Unique constraint violation on (provider, event_id) means duplicate
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { kind: "duplicate" };
    }
    // Other errors (DB down, etc.) should not block webhook processing
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
