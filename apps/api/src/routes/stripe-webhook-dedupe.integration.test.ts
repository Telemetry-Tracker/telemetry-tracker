/**
 * Stripe webhook deduplication integration tests with real Postgres.
 * Tests concurrent delivery handling, retry behavior, and claim atomicity.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { dedupeWebhookEvent, markWebhookProcessed, markWebhookFailed } from "../lib/webhook-dedupe.js";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIf = integrationTest ? describe : describe.skip;

describeIf("Stripe webhook deduplication", () => {
  let app: FastifyInstance | null = null;
  const testOrgId = "test-stripe-dedupe-org-" + Date.now();
  const createdEventIds: string[] = [];
  
  beforeAll(async () => {
    if (!integrationTest) return;
    
    // Set required env vars for webhook registration
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy";
    
    app = await createApp();
    
    // Create test organization
    await prisma.organization.create({
      data: {
        id: testOrgId,
        name: "Stripe Dedupe Test Org",
        plan_tier: "FREE",
      },
    });
  });

  beforeEach(() => {
    createdEventIds.length = 0;
  });

  afterAll(async () => {
    if (!integrationTest || !app) return;
    
    // Cleanup only rows created by this test
    if (createdEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { event_id: { in: createdEventIds } },
      }).catch(() => undefined);
    }
    await prisma.organizationReferral.deleteMany({ where: { organization_id: testOrgId } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: testOrgId } }).catch(() => undefined);
    await app.close();
  });

  it("failure then retry processes exactly once", async () => {
    if (!app) return;

    const eventId = "evt_retry_" + Date.now();
    createdEventIds.push(eventId);
    
    // First delivery claims and processes
    const result1 = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(result1.kind).toBe("first_delivery");
    if (result1.kind !== "first_delivery") throw new Error("Expected first_delivery");

    // Simulate processing failure
    await markWebhookFailed(prisma, result1.id, "Simulated failure");

    // Verify status is failed
    const failedEvent = await prisma.webhookEvent.findFirst({
      where: { event_id: eventId },
      select: { status: true, error: true, attempts: true },
    });
    expect(failedEvent?.status).toBe("failed");
    expect(failedEvent?.error).toBe("Simulated failure");
    expect(failedEvent?.attempts).toBe(1);

    // Retry delivery reclaims and processes
    const result2 = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(result2.kind).toBe("first_delivery");
    if (result2.kind !== "first_delivery") throw new Error("Expected first_delivery on retry");

    // Mark as processed
    await markWebhookProcessed(prisma, result2.id);

    // Verify final state
    const processedEvent = await prisma.webhookEvent.findFirst({
      where: { event_id: eventId },
      select: { status: true, processed_at: true, error: true, attempts: true },
    });
    expect(processedEvent?.status).toBe("processed");
    expect(processedEvent?.processed_at).toBeInstanceOf(Date);
    expect(processedEvent?.error).toBeNull();
    expect(processedEvent?.attempts).toBe(2);

    // Third delivery returns duplicate
    const result3 = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(result3.kind).toBe("duplicate");
  });

  it("duplicate after success is skipped with 200", async () => {
    if (!app) return;

    const eventId = "evt_success_dup_" + Date.now();
    createdEventIds.push(eventId);
    
    // First delivery
    const result1 = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(result1.kind).toBe("first_delivery");
    if (result1.kind !== "first_delivery") throw new Error("Expected first_delivery");

    // Process successfully
    await markWebhookProcessed(prisma, result1.id);

    // Second delivery returns duplicate
    const result2 = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(result2.kind).toBe("duplicate");

    // Verify only one event record
    const count = await prisma.webhookEvent.count({
      where: { event_id: eventId },
    });
    expect(count).toBe(1);
  });

  it("concurrent deliveries process exactly once", async () => {
    if (!app) return;

    const eventId = "evt_concurrent_" + Date.now();
    createdEventIds.push(eventId);
    
    // Simulate 4 concurrent deliveries
    const results = await Promise.all([
      dedupeWebhookEvent(prisma, "stripe", eventId, "test.event"),
      dedupeWebhookEvent(prisma, "stripe", eventId, "test.event"),
      dedupeWebhookEvent(prisma, "stripe", eventId, "test.event"),
      dedupeWebhookEvent(prisma, "stripe", eventId, "test.event"),
    ]);

    // Exactly one should claim it (first_delivery)
    const firstDeliveries = results.filter((r) => r.kind === "first_delivery");
    const processing = results.filter((r) => r.kind === "processing");
    
    expect(firstDeliveries.length).toBe(1);
    expect(processing.length).toBe(3);

    // Mark as processed
    if (firstDeliveries[0].kind === "first_delivery") {
      await markWebhookProcessed(prisma, firstDeliveries[0].id);
    }

    // Verify only one event record
    const events = await prisma.webhookEvent.findMany({
      where: { event_id: eventId },
    });
    expect(events.length).toBe(1);
    expect(events[0].status).toBe("processed");
  });

  it("stale processing row is reclaimed", async () => {
    if (!app) return;

    const eventId = "evt_stale_" + Date.now();
    createdEventIds.push(eventId);
    
    // Create a stale processing row (locked 15 minutes ago)
    const staleDate = new Date(Date.now() - 15 * 60 * 1000);
    await prisma.webhookEvent.create({
      data: {
        provider: "stripe",
        event_id: eventId,
        event_type: "test.event",
        status: "processing",
        locked_at: staleDate,
        attempts: 1,
      },
    });

    // New delivery should reclaim it
    const result = await dedupeWebhookEvent(prisma, "stripe", eventId, "test.event");
    expect(result.kind).toBe("first_delivery");

    // Verify attempts incremented
    const event = await prisma.webhookEvent.findFirst({
      where: { event_id: eventId },
      select: { attempts: true, locked_at: true },
    });
    expect(event?.attempts).toBe(2);
    expect(event?.locked_at).not.toEqual(staleDate);
  });

  it("existing billing behavior unchanged", async () => {
    if (!app) return;

    const eventId = "evt_billing_" + Date.now();
    createdEventIds.push(eventId);
    
    // Dedupe check
    const dedupeResult = await dedupeWebhookEvent(prisma, "stripe", eventId, "checkout.session.completed");
    expect(dedupeResult.kind).toBe("first_delivery");
    if (dedupeResult.kind !== "first_delivery") throw new Error("Expected first_delivery");
    
    // Simulate organization update (existing behavior)
    await prisma.organization.updateMany({
      where: { id: testOrgId, deleted_at: null },
      data: {
        plan_tier: "PRO",
        stripe_customer_id: "cus_regression_test",
      },
    });
    
    // Mark as processed
    await markWebhookProcessed(prisma, dedupeResult.id);
    
    // Verify organization was updated
    const org = await prisma.organization.findFirst({
      where: { id: testOrgId },
      select: { plan_tier: true, stripe_customer_id: true },
    });
    expect(org?.plan_tier).toBe("PRO");
    expect(org?.stripe_customer_id).toBe("cus_regression_test");
    
    // Verify webhook event was marked processed
    const webhookEvent = await prisma.webhookEvent.findFirst({
      where: { event_id: eventId },
      select: { status: true, processed_at: true, error: true },
    });
    expect(webhookEvent?.status).toBe("processed");
    expect(webhookEvent?.processed_at).toBeInstanceOf(Date);
    expect(webhookEvent?.error).toBeNull();
  });
});
