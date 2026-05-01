import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runRetentionSweep } from "./retention.js";

describe("runRetentionSweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires sessions by end time so active long-running sessions are retained", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));

    const deleteSessionMany = vi.fn(async () => ({ count: 2 }));
    const prisma = {
      project: {
        findMany: vi.fn(async () => [
          {
            id: "project-1",
            organization: { plan_tier: "FREE", deleted_at: null },
          },
        ]),
      },
      $transaction: vi.fn(async (fn) =>
        fn({
          errorOccurrence: {
            deleteMany: vi.fn(async () => ({ count: 0 })),
          },
          event: {
            deleteMany: vi.fn(async () => ({ count: 0 })),
          },
          session: {
            deleteMany: deleteSessionMany,
          },
          errorGroup: {
            deleteMany: vi.fn(async () => ({ count: 0 })),
          },
          $executeRaw: vi.fn(async () => 0),
        })
      ),
    } as unknown as PrismaClient;

    const result = await runRetentionSweep(prisma);

    expect(result.sessionsDeleted).toBe(2);
    expect(deleteSessionMany).toHaveBeenCalledWith({
      where: {
        project_id: "project-1",
        ended_at: { lt: new Date("2026-04-17T10:00:00.000Z") },
      },
    });
  });
});
