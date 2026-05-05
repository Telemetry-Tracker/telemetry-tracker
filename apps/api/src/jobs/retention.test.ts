import { PlanTier } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { runRetentionSweep } from "./retention.js";

describe("runRetentionSweep", () => {
  it("retains open and recently closed long-running sessions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T00:00:00.000Z"));

    const deletedSessionPredicates: unknown[] = [];
    const prisma = {
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-1",
            organization: {
              plan_tier: PlanTier.FREE,
              stripe_subscription_status: null,
              deleted_at: null,
            },
          },
        ]),
      },
      $transaction: vi.fn(async (fn) =>
        fn({
          errorOccurrence: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          event: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          session: {
            deleteMany: vi.fn(async (args: unknown) => {
              deletedSessionPredicates.push(args);
              return { count: 0 };
            }),
          },
          errorGroup: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          $executeRaw: vi.fn().mockResolvedValue(0),
        })
      ),
    };

    try {
      await runRetentionSweep(prisma as never);
    } finally {
      vi.useRealTimers();
    }

    expect(deletedSessionPredicates).toEqual([
      {
        where: {
          project_id: "project-1",
          ended_at: { lt: new Date("2026-04-21T00:00:00.000Z") },
        },
      },
    ]);
  });
});
