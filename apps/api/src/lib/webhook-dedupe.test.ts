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

      expect(result.kind).toBe("first_delivery");
      if (result.kind === "first_delivery") {
        expect(result.id).toBe("evt_123");
        expect(result.claimToken).toBeDefined();
        expect(typeof result.claimToken).toBe("string");
      }
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          provider: "stripe",
          event_id: "evt_abc",
          event_type: "checkout.session.completed",
          status: "processing",
          locked_at: expect.any(Date),
          attempts: 1,
          claim_token: expect.any(String),
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
      if (result.kind === "first_delivery") {
        expect(result.id).toBe("evt_retry");
      }
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
        "stripe",
        "evt_no_type"
      );

      expect(result.kind).toBe("first_delivery");
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          provider: "stripe",
          event_id: "evt_no_type",
          event_type: null,
          status: "processing",
          locked_at: expect.any(Date),
          attempts: 1,
          claim_token: expect.any(String),
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
          "stripe",
          "evt_123"
        )
      ).rejects.toThrow("DB connection failed");
    });
  });

  describe("markWebhookProcessed", () => {
    it("marks event as processed with claim token guard", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await markWebhookProcessed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "evt_123",
        "claim_abc"
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe("markWebhookFailed", () => {
    it("marks event as failed with error message and claim token guard", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await markWebhookFailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "evt_123",
        "claim_abc",
        "Processing failed"
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("truncates long error messages", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      const longError = "x".repeat(2000);

      await markWebhookFailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockPrisma as any,
        "evt_123",
        "claim_abc",
        longError
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });
});
