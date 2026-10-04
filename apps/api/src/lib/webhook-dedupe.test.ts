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
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dedupeWebhookEvent", () => {
    it("returns first_delivery for new event", async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_123" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "stripe",
        "evt_abc",
        "checkout.session.completed"
      );

      expect(result).toEqual({ kind: "first_delivery", id: "evt_123" });
      expect(mockPrisma.webhookEvent.findUnique).toHaveBeenCalled();
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          provider: "stripe",
          event_id: "evt_abc",
          event_type: "checkout.session.completed",
        },
        select: { id: true },
      });
    });

    it("returns duplicate for successfully processed event", async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: "evt_existing",
        processed_at: new Date(),
        error: null,
      });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "stripe",
        "evt_duplicate",
        "invoice.paid"
      );

      expect(result).toEqual({ kind: "duplicate" });
      expect(mockPrisma.webhookEvent.delete).not.toHaveBeenCalled();
    });

    it("retries previously failed event", async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: "evt_failed",
        processed_at: null,
        error: "Previous failure",
      });
      mockPrisma.webhookEvent.delete.mockResolvedValue({ id: "evt_failed" });
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_retry" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "stripe",
        "evt_failed",
        "invoice.paid"
      );

      expect(result.kind).toBe("first_delivery");
      expect(result.id).toBe("evt_retry");
      expect(mockPrisma.webhookEvent.delete).toHaveBeenCalled();
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalled();
    });

    it("treats DB errors as first_delivery (at-least-once)", async () => {
      const dbError = new Error("DB connection failed");
      mockPrisma.webhookEvent.findUnique.mockRejectedValue(dbError);

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "rewardful",
        "rwf_evt_123"
      );

      expect(result).toEqual({ kind: "first_delivery", id: "unknown" });
    });

    it("handles events without event_type", async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_456" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "rewardful",
        "rwf_evt_no_type"
      );

      expect(result.kind).toBe("first_delivery");
      expect(mockPrisma.webhookEvent.findUnique).toHaveBeenCalled();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await markWebhookProcessed(mockPrisma as any, "evt_123");

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: "evt_123" },
        data: { processed_at: expect.any(Date) },
      });
    });

    it("skips update for unknown webhook ID", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await markWebhookProcessed(mockPrisma as any, "unknown");

      expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
    });
  });

  describe("markWebhookFailed", () => {
    it("updates webhook event with error", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await markWebhookFailed(mockPrisma as any, "evt_123", longError);

      const updateCall = mockPrisma.webhookEvent.update.mock.calls[0][0];
      expect(updateCall.data.error.length).toBeLessThanOrEqual(1000);
    });

    it("skips update for unknown webhook ID", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await markWebhookFailed(mockPrisma as any, "unknown", "Error");

      expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
    });
  });
});
