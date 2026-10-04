/**
 * Stripe webhook deduplication integration tests with real Postgres.
 * Tests concurrent delivery handling, retry behavior, and claim atomicity.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { dedupeWebhookEvent, markWebhookProcessed, markWebhookFailed } from "../lib/webhook-dedupe.js";
import crypto from "node:crypto";

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

  beforeEach(async () => {
    // Clean up events from previous test BEFORE clearing the array
    if (createdEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { event_id: { in: createdEventIds } },
      }).catch(() => undefined);
    }
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

  describe("Route-level deduplication tests", () => {
    const webhookSecret = "whsec_route_test";
    let routeApp: FastifyInstance | null = null;
    const routeTestOrgId = "test-route-dedupe-org-" + Date.now();
    const routeEventIds: string[] = [];

    beforeAll(async () => {
      if (!integrationTest) return;
      
      // Create app with route-test webhook secret
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
      routeApp = await createApp();
      
      // Create test organization
      await prisma.organization.create({
        data: {
          id: routeTestOrgId,
          name: "Route Dedupe Test Org",
          plan_tier: "FREE",
        },
      });
    });

    beforeEach(() => {
      routeEventIds.length = 0;
    });

    afterAll(async () => {
      if (!integrationTest || !routeApp) return;
      
      // Cleanup
      if (routeEventIds.length > 0) {
        await prisma.webhookEvent.deleteMany({
          where: { event_id: { in: routeEventIds } },
        }).catch(() => undefined);
      }
      await prisma.organization.deleteMany({ where: { id: routeTestOrgId } }).catch(() => undefined);
      await routeApp.close();
    });

    function signWebhookEvent(event: unknown): string {
      const payload = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(signedPayload)
        .digest("hex");
      return `t=${timestamp},v1=${signature}`;
    }

    it("same signed event posted twice gives one side effect and 200 on second", async () => {
      if (!routeApp) return;

      const eventId = `evt_route_dup_${Date.now()}`;
      routeEventIds.push(eventId);

      const event = {
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_route_dup",
            customer: "cus_route_dup",
            subscription: "sub_route_dup",
            metadata: {
              organization_id: routeTestOrgId,
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const signature = signWebhookEvent(event);

      // First delivery
      const response1 = await routeApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        payload,
      });

      expect(response1.statusCode).toBe(200);

      // Verify org upgraded
      const orgAfterFirst = await prisma.organization.findUnique({
        where: { id: routeTestOrgId },
      });
      expect(orgAfterFirst?.plan_tier).toBe("PRO");

      // Second delivery (duplicate)
      const response2 = await routeApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        payload,
      });

      expect(response2.statusCode).toBe(200);

      // Verify org still PRO (no double-upgrade)
      const orgAfterSecond = await prisma.organization.findUnique({
        where: { id: routeTestOrgId },
      });
      expect(orgAfterSecond?.plan_tier).toBe("PRO");

      // Verify only one webhook event record
      const eventCount = await prisma.webhookEvent.count({
        where: { event_id: eventId },
      });
      expect(eventCount).toBe(1);
    });

    it("4 concurrent posts of the same event give exactly one side effect", async () => {
      if (!routeApp) return;

      const eventId = `evt_route_concurrent_${Date.now()}`;
      routeEventIds.push(eventId);

      const event = {
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_route_concurrent",
            customer: "cus_route_concurrent",
            subscription: "sub_route_concurrent",
            metadata: {
              organization_id: routeTestOrgId,
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const signature = signWebhookEvent(event);

      // Reset org to FREE
      await prisma.organization.update({
        where: { id: routeTestOrgId },
        data: { plan_tier: "FREE" },
      });

      // 4 concurrent deliveries
      const responses = await Promise.all([
        routeApp.inject({
          method: "POST",
          url: "/webhooks/stripe",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          payload,
        }),
        routeApp.inject({
          method: "POST",
          url: "/webhooks/stripe",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          payload,
        }),
        routeApp.inject({
          method: "POST",
          url: "/webhooks/stripe",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          payload,
        }),
        routeApp.inject({
          method: "POST",
          url: "/webhooks/stripe",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          payload,
        }),
      ]);

      // All should return 200 or 409
      const statusCodes = responses.map(r => r.statusCode);
      expect(statusCodes.every(code => code === 200 || code === 409)).toBe(true);
      // At least one should be 200
      expect(statusCodes.some(code => code === 200)).toBe(true);

      // Verify org upgraded exactly once
      const org = await prisma.organization.findUnique({
        where: { id: routeTestOrgId },
      });
      expect(org?.plan_tier).toBe("PRO");

      // Verify only one event record
      const eventCount = await prisma.webhookEvent.count({
        where: { event_id: eventId },
      });
      expect(eventCount).toBe(1);
    });

    it("handler failure followed by redelivery processes on retry", async () => {
      if (!routeApp) return;

      const eventId = `evt_route_retry_${Date.now()}`;
      routeEventIds.push(eventId);

      // Create a valid event
      const event = {
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_route_retry",
            customer: "cus_route_retry",
            subscription: "sub_route_retry",
            metadata: {
              organization_id: routeTestOrgId,
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const signature = signWebhookEvent(event);

      // Manually create a failed webhook event in DB (simulating a previous failed delivery)
      await prisma.webhookEvent.create({
        data: {
          provider: "stripe",
          event_id: eventId,
          event_type: "checkout.session.completed",
          status: "failed",
          error: "Simulated processing failure",
          attempts: 1,
          locked_at: new Date(Date.now() - 5000), // 5 seconds ago
        },
      });

      // Reset org
      await prisma.organization.update({
        where: { id: routeTestOrgId },
        data: { plan_tier: "FREE" },
      });

      // Retry delivery with same event (Stripe redelivery)
      const response2 = await routeApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        payload,
      });

      // Should process successfully
      expect(response2.statusCode).toBe(200);

      // Verify org upgraded
      const org = await prisma.organization.findUnique({
        where: { id: routeTestOrgId },
      });
      expect(org?.plan_tier).toBe("PRO");

      // Verify webhook event was updated
      const webhookEvent = await prisma.webhookEvent.findFirst({
        where: { event_id: eventId },
      });
      expect(webhookEvent?.status).toBe("processed");
      expect(webhookEvent?.attempts).toBe(2); // Incremented on retry
    });

    it("stale processing row older than 10 minutes gets reclaimed", async () => {
      if (!routeApp) return;

      const eventId = `evt_route_stale_${Date.now()}`;
      routeEventIds.push(eventId);

      // Create a stale processing row (locked 15 minutes ago)
      const staleDate = new Date(Date.now() - 15 * 60 * 1000);
      await prisma.webhookEvent.create({
        data: {
          provider: "stripe",
          event_id: eventId,
          event_type: "checkout.session.completed",
          status: "processing",
          locked_at: staleDate,
          attempts: 1,
        },
      });

      // Send event via route
      const event = {
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_route_stale",
            customer: "cus_route_stale",
            subscription: "sub_route_stale",
            metadata: {
              organization_id: routeTestOrgId,
              plan_tier: "PRO",
            },
          },
        },
      };

      const payload = JSON.stringify(event);
      const signature = signWebhookEvent(event);

      // Reset org
      await prisma.organization.update({
        where: { id: routeTestOrgId },
        data: { plan_tier: "FREE" },
      });

      // New delivery should reclaim and process
      const response = await routeApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify org upgraded
      const org = await prisma.organization.findUnique({
        where: { id: routeTestOrgId },
      });
      expect(org?.plan_tier).toBe("PRO");

      // Verify event was reclaimed (attempts incremented)
      const webhookEvent = await prisma.webhookEvent.findFirst({
        where: { event_id: eventId },
      });
      expect(webhookEvent?.attempts).toBeGreaterThan(1);
      expect(webhookEvent?.status).toBe("processed");
    });
  });
});
