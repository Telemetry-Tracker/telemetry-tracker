/**
 * Webhook deduplication with atomic claim-based design.
 * Handles concurrent deliveries and retries safely.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

export type WebhookProvider = "stripe";

export type WebhookDedupeResult =
  | { kind: "first_delivery"; id: string; claimToken: string }
  | { kind: "duplicate" }
  | { kind: "processing"; retryAfterMs: number };

/**
 * Claim a webhook event for processing.
 * Returns "first_delivery" with ID and claim token if claimed, "duplicate" if already processed successfully,
 * or "processing" if another delivery is currently processing it.
 */
export async function dedupeWebhookEvent(
  prisma: PrismaClient,
  provider: WebhookProvider,
  eventId: string,
  eventType?: string
): Promise<WebhookDedupeResult> {
  const claimToken = randomBytes(16).toString("hex");
  const now = new Date();
  
  try {
    // Try to insert as a new event
    const created = await prisma.webhookEvent.create({
      data: {
        provider,
        event_id: eventId,
        event_type: eventType ?? null,
        status: "processing",
        locked_at: now,
        attempts: 1,
        claim_token: claimToken,
      },
      select: { id: true },
    });
    return { kind: "first_delivery", id: created.id, claimToken };
  } catch (err) {
    // Unique constraint violation - event exists
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      // Try to reclaim if it's stale or failed
      const reclaimNow = new Date();
      const staleThreshold = new Date(reclaimNow.getTime() - 10 * 60 * 1000); // 10 minutes ago

      try {
        const reclaimed = await prisma.$executeRaw<number>(
          Prisma.sql`
            UPDATE "WebhookEvent"
            SET status = 'processing',
                locked_at = ${reclaimNow},
                attempts = attempts + 1,
                error = NULL,
                claim_token = ${claimToken}
            WHERE provider = ${provider}
              AND event_id = ${eventId}
              AND (status = 'failed' OR (status = 'processing' AND locked_at < ${staleThreshold}))
            RETURNING id
          `
        );

        if (reclaimed > 0) {
          // Successfully reclaimed - get the ID
          const event = await prisma.webhookEvent.findUnique({
            where: { provider_event_id: { provider, event_id: eventId } },
            select: { id: true },
          });
          return { kind: "first_delivery", id: event!.id, claimToken };
        }

        // Couldn't reclaim - check current status
        const existing = await prisma.webhookEvent.findUnique({
          where: { provider_event_id: { provider, event_id: eventId } },
          select: { status: true },
        });

        if (existing?.status === "processed") {
          return { kind: "duplicate" };
        }

        // Still processing by another delivery
        return { kind: "processing", retryAfterMs: 5000 };
      } catch {
        // Reclaim failed - treat as processing
        return { kind: "processing", retryAfterMs: 5000 };
      }
    }

    // Other DB errors - fail safe by not processing
    throw err;
  }
}

/**
 * Mark webhook event as successfully processed.
 * Only marks if the claim token matches (ownership guard).
 */
export async function markWebhookProcessed(
  prisma: PrismaClient,
  webhookEventId: string,
  claimToken: string
): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "WebhookEvent"
      SET status = 'processed',
          processed_at = ${now},
          error = NULL
      WHERE id = ${webhookEventId}
        AND status = 'processing'
        AND claim_token = ${claimToken}
        AND locked_at <= ${now}
    `
  );
}

/**
 * Mark webhook event as failed (will be retried by provider).
 * Only marks if the claim token matches (ownership guard).
 */
export async function markWebhookFailed(
  prisma: PrismaClient,
  webhookEventId: string,
  claimToken: string,
  errorMessage: string
): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "WebhookEvent"
      SET status = 'failed',
          error = ${errorMessage.slice(0, 1000)}
      WHERE id = ${webhookEventId}
        AND status = 'processing'
        AND claim_token = ${claimToken}
        AND locked_at <= ${now}
    `
  );
}
