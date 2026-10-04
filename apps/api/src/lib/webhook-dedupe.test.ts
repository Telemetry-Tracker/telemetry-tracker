import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  dedupeWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
} from "./webhook-dedupe.js";

describe("webhook-dedupe", () => {
  const mockPrisma = {
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dedupeWebhookEvent", () => {
    it("returns first_delivery for new event", async () => {
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_123" });

      const result = await dedupeWebhookEvent(
        mockPrisma as any,
        "stripe",
        "evt_abc",
        "checkout.session.completed"
      );

      expect(result).toEqual({ kind: "first_delivery", id: "evt_123" });
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          provider: "stripe",
          event_id: "evt_abc",
          event_type: "checkout.session.completed",
        },
        select: { id: true },
      });
    });

    it("returns duplicate for already-seen event", async () => {
      const uniqueConstraintError = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
      });
      mockPrisma.webhookEvent.create.mockRejectedValue(uniqueConstraintError);

      const result = await dedupeWebhookEvent(
        mockPrisma as any,
        "stripe",
        "evt_duplicate",
        "invoice.paid"
      );

      expect(result).toEqual({ kind: "duplicate" });
    });

    it("treats DB errors as first_delivery (at-least-once)", async () => {
      const dbError = new Error("DB connection failed");
      mockPrisma.webhookEvent.create.mockRejectedValue(dbError);

      const result = await dedupeWebhookEvent(
        mockPrisma as any,
        "rewardful",
        "rwf_evt_123"
      );

      expect(result).toEqual({ kind: "first_delivery", id: "unknown" });
    });

    it("handles events without event_type", async () => {
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_456" });

      const result = await dedupeWebhookEvent(
        mockPrisma as any,
        "rewardful",
        "rwf_evt_no_type"
      );

      expect(result.kind).toBe("first_delivery");
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          provider: "rewardful",
          event_id: "rwf_evt_no_type",
          event_type: null,
        },
        select: { id: true },
      });
    });
  });

  describe("markWebhookProcessed", () => {
    it("updates webhook event with processed_at", async () => {
      await markWebhookProcessed(mockPrisma as any, "evt_123");

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: "evt_123" },
        data: { processed_at: expect.any(Date) },
      });
    });

    it("skips update for unknown webhook ID", async () => {
      await markWebhookProcessed(mockPrisma as any, "unknown");

      expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
    });
  });

  describe("markWebhookFailed", () => {
    it("updates webhook event with error", async () => {
      await markWebhookFailed(mockPrisma as any, "evt_123", "Processing failed");

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: "evt_123" },
        data: {
          processed_at: expect.any(Date),
          error: "Processing failed",
        },
      });
    });

    it("truncates long error messages", async () => {
      const longError = "x".repeat(2000);
      await markWebhookFailed(mockPrisma as any, "evt_123", longError);

      const updateCall = mockPrisma.webhookEvent.update.mock.calls[0][0];
      expect(updateCall.data.error.length).toBeLessThanOrEqual(1000);
    });

    it("skips update for unknown webhook ID", async () => {
      await markWebhookFailed(mockPrisma as any, "unknown", "Error");

      expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
    });
  });
});
