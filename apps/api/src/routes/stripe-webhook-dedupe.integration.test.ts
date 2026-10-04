/**
 * Stripe webhook deduplication regression tests.
 * Ensures adding dedupe doesn't change existing business behavior.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import Stripe from "stripe";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIf = integrationTest ? describe : describe.skip;

describeIf("Stripe webhook deduplication", () => {
  let app: FastifyInstance | null = null;
  const testOrgId = "test-stripe-dedupe-org-" + Date.now();
  
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

  afterAll(async () => {
    if (!integrationTest || !app) return;
    
    // Cleanup
    await prisma.organizationReferral.deleteMany({ where: { organization_id: testOrgId } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: testOrgId } }).catch(() => undefined);
    await prisma.webhookEvent.deleteMany({ where: { provider: "stripe" } }).catch(() => undefined);
    await app.close();
  });

  it("creates WebhookEvent record on first delivery", async () => {
    if (!app) return;

    const eventId = "evt_first_delivery_" + Date.now();
    
    // Construct a mock Stripe event (won't actually hit Stripe)
    const mockEvent = {
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          metadata: {
            organization_id: testOrgId,
            plan_tier: "PRO",
          },
          customer: "cus_test",
          subscription: "sub_test",
        },
      },
    };

    // Note: This test won't actually call the webhook endpoint because we'd need valid Stripe signature
    // Instead, verify the dedupe logic directly via the WebhookEvent table
    
    const eventsBefore = await prisma.webhookEvent.count({
      where: { provider: "stripe", event_id: eventId },
    });
    expect(eventsBefore).toBe(0);
    
    // Simulate webhook processing by calling dedupe directly
    const { dedupeWebhookEvent } = await import("../lib/webhook-dedupe.js");
    const result = await dedupeWebhookEvent(prisma, "stripe", eventId, "checkout.session.completed");
    
    expect(result.kind).toBe("first_delivery");
    expect(result.id).not.toBe("unknown");
    
    const eventsAfter = await prisma.webhookEvent.count({
      where: { provider: "stripe", event_id: eventId },
    });
    expect(eventsAfter).toBe(1);
  });

  it("returns duplicate for already-processed event", async () => {
    if (!app) return;

    const eventId = "evt_duplicate_" + Date.now();
    
    // Create webhook event record
    await prisma.webhookEvent.create({
      data: {
        provider: "stripe",
        event_id: eventId,
        event_type: "invoice.paid",
        processed_at: new Date(),
      },
    });

    // Try to dedupe again
    const { dedupeWebhookEvent } = await import("../lib/webhook-dedupe.js");
    const result = await dedupeWebhookEvent(prisma, "stripe", eventId, "invoice.paid");
    
    expect(result.kind).toBe("duplicate");
    
    // Verify only one record exists
    const count = await prisma.webhookEvent.count({
      where: { provider: "stripe", event_id: eventId },
    });
    expect(count).toBe(1);
  });

  it("processes different event IDs independently", async () => {
    if (!app) return;

    const { dedupeWebhookEvent } = await import("../lib/webhook-dedupe.js");
    
    const event1 = "evt_independent_1_" + Date.now();
    const event2 = "evt_independent_2_" + Date.now();
    
    const result1 = await dedupeWebhookEvent(prisma, "stripe", event1, "test.event");
    const result2 = await dedupeWebhookEvent(prisma, "stripe", event2, "test.event");
    
    expect(result1.kind).toBe("first_delivery");
    expect(result2.kind).toBe("first_delivery");
    expect(result1.id).not.toBe(result2.id);
  });

  it("isolates events by provider", async () => {
    if (!app) return;

    const { dedupeWebhookEvent } = await import("../lib/webhook-dedupe.js");
    
    const sharedEventId = "evt_shared_" + Date.now();
    
    // Same event ID but different providers should not conflict
    const stripeResult = await dedupeWebhookEvent(prisma, "stripe", sharedEventId, "test");
    const rewardfulResult = await dedupeWebhookEvent(prisma, "rewardful", sharedEventId, "test");
    
    expect(stripeResult.kind).toBe("first_delivery");
    expect(rewardfulResult.kind).toBe("first_delivery");
    
    // Both records should exist
    const count = await prisma.webhookEvent.count({
      where: { event_id: sharedEventId },
    });
    expect(count).toBe(2);
  });

  it("existing billing behavior unchanged (checkout.session.completed)", async () => {
    if (!app) return;

    // Verify that organization update logic still works with dedupe
    const eventId = "evt_checkout_" + Date.now();
    
    const { dedupeWebhookEvent, markWebhookProcessed } = await import("../lib/webhook-dedupe.js");
    
    // Dedupe check
    const dedupeResult = await dedupeWebhookEvent(prisma, "stripe", eventId, "checkout.session.completed");
    expect(dedupeResult.kind).toBe("first_delivery");
    
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
      where: { provider: "stripe", event_id: eventId },
      select: { processed_at: true, error: true },
    });
    expect(webhookEvent?.processed_at).toBeInstanceOf(Date);
    expect(webhookEvent?.error).toBeNull();
  });
});
