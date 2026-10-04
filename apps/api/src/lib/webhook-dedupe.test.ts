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
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dedupeWebhookEvent", () => {
    it("returns first_delivery for new event", async () => {
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_123" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          status: "processing",
          locked_at: expect.any(Date),
          attempts: 1,
        },
        select: { id: true },
      });
    });

    it("returns duplicate for successfully processed event", async () => {
      const uniqueConstraintError = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
      });
      mockPrisma.webhookEvent.create.mockRejectedValue(uniqueConstraintError);
      mockPrisma.$executeRaw.mockResolvedValue(0); // No rows updated
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({ status: "processed" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "stripe",
        "evt_duplicate",
        "invoice.paid"
      );

      expect(result).toEqual({ kind: "duplicate" });
    });

    it("reclaims and processes failed event", async () => {
      const uniqueConstraintError = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
      });
      mockPrisma.webhookEvent.create.mockRejectedValue(uniqueConstraintError);
      mockPrisma.$executeRaw.mockResolvedValue(1); // 1 row updated
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({ id: "evt_retry" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "stripe",
        "evt_failed",
        "invoice.paid"
      );

      expect(result.kind).toBe("first_delivery");
      expect(result.id).toBe("evt_retry");
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("returns processing for event being handled by another delivery", async () => {
      const uniqueConstraintError = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
      });
      mockPrisma.webhookEvent.create.mockRejectedValue(uniqueConstraintError);
      mockPrisma.$executeRaw.mockResolvedValue(0); // No rows updated
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({ status: "processing" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "stripe",
        "evt_processing",
        "invoice.paid"
      );

      expect(result).toEqual({ kind: "processing", retryAfterMs: 5000 });
    });

    it("handles events without event_type", async () => {
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: "evt_456" });

      const result = await dedupeWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          status: "processing",
          locked_at: expect.any(Date),
          attempts: 1,
        },
        select: { id: true },
      });
    });

    it("throws on non-P2002 DB errors", async () => {
      const dbError = new Error("DB connection failed");
      mockPrisma.webhookEvent.create.mockRejectedValue(dbError);

      await expect(
        dedupeWebhookEvent(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockPrisma as any,
          "rewardful",
          "rwf_evt_123"
        )
      ).rejects.toThrow("DB connection failed");
    });
  });

  describe("markWebhookProcessed", () => {
    it("marks event as processed", async () => {
      mockPrisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      await markWebhookProcessed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "evt_123"
      );

      expect(mockPrisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: "evt_123",
          status: "processing",
        },
        data: {
          status: "processed",
          processed_at: expect.any(Date),
          error: null,
        },
      });
    });
  });

  describe("markWebhookFailed", () => {
    it("marks event as failed with error message", async () => {
      mockPrisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      await markWebhookFailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "evt_123",
        "Processing failed"
      );

      expect(mockPrisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: "evt_123",
          status: "processing",
        },
        data: {
          status: "failed",
          error: "Processing failed",
        },
      });
    });

    it("truncates long error messages", async () => {
      mockPrisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      const longError = "x".repeat(2000);

      await markWebhookFailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "evt_123",
        longError
      );

      expect(mockPrisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: "evt_123",
          status: "processing",
        },
        data: {
          status: "failed",
          error: "x".repeat(1000),
        },
      });
    });
  });
});
