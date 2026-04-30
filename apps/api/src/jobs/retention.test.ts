import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runRetentionSweep } from "./retention.js";

describe("runRetentionSweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires sessions by end time so active long-running sessions are retained", async () => {
    const now = new Date("2026-04-30T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    let sessionDeleteWhere: unknown;
    const tx = {
      errorOccurrence: {
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 }),
      },
      event: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      session: {
        deleteMany: vi.fn().mockImplementation((args: { where: unknown }) => {
          sessionDeleteWhere = args.where;
          return Promise.resolve({ count: 0 });
        }),
      },
      errorGroup: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(0),
    };
    const prisma = {
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-1",
            organization: { plan_tier: "FREE", deleted_at: null },
          },
        ]),
      },
      $transaction: vi.fn(
        (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)
      ),
    } as unknown as PrismaClient;

    await runRetentionSweep(prisma);

    expect(sessionDeleteWhere).toEqual({
      project_id: "project-1",
      ended_at: { lt: new Date("2026-04-16T10:00:00.000Z") },
    });
  });
});
