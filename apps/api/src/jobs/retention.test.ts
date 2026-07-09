import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanTier } from "@prisma/client";
import { runRetentionSweep } from "./retention.js";

function sqlFromExecuteRaw(query: unknown): string {
  if (typeof query !== "object" || query === null || !("strings" in query)) {
    return String(query);
  }
  return (query as { strings: string[] }).strings.join("");
}

describe("runRetentionSweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires sessions by end time so open long-running sessions are retained", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T10:00:00.000Z"));

    const cutoff = new Date("2026-04-22T10:00:00.000Z");
    const sessionDeleteMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // Simulate one old closed session and one old still-open session. A started_at
      // predicate would delete both; ended_at deletes only the closed one.
      return { count: "ended_at" in where ? 1 : 2 };
    });
    const executeRaw = vi.fn(async (query: unknown) => {
      if (sqlFromExecuteRaw(query).includes("SourceMapArtifact")) return 3;
      return 0;
    });
    const tx = {
      errorOccurrence: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      event: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      session: { deleteMany: sessionDeleteMany },
      errorGroup: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      $executeRaw: executeRaw,
    };
    const prisma = {
      project: {
        findMany: vi.fn(async () => [
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
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never);

    expect(result.sessionsDeleted).toBe(1);
    expect(result.sourceMapsDeleted).toBe(3);
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: {
        project_id: "project-1",
        ended_at: { lt: cutoff },
      },
    });

    const mapDeleteSql = executeRaw.mock.calls
      .map(([query]) => sqlFromExecuteRaw(query))
      .find((sql) => sql.includes("SourceMapArtifact"));
    expect(mapDeleteSql).toBeDefined();
    expect(mapDeleteSql).toContain('FROM "SourceMapArtifact"');
    expect(mapDeleteSql).toContain("uploaded_at");
    expect(mapDeleteSql).toContain('FROM "ErrorGroup"');
    expect(mapDeleteSql).toContain("last_seen");
  });

  it("does not delete source maps while in-window error groups reference the release", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T10:00:00.000Z"));

    const executeRaw = vi.fn(async (query: unknown) => {
      const sql = sqlFromExecuteRaw(query);
      if (sql.includes("SourceMapArtifact")) {
        expect(sql).toContain("NOT EXISTS");
        expect(sql).toContain("eg.release = sma.release");
        expect(sql).toContain("eg.last_seen >=");
        return 0;
      }
      return 0;
    });
    const tx = {
      errorOccurrence: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      event: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      errorGroup: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      $executeRaw: executeRaw,
    };
    const prisma = {
      project: {
        findMany: vi.fn(async () => [
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
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never);

    expect(result.sourceMapsDeleted).toBe(0);
    expect(executeRaw.mock.calls.some(([query]) => sqlFromExecuteRaw(query).includes("SourceMapArtifact"))).toBe(
      true
    );
  });

  it("dry-run counts rows without deleting or updating", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T10:00:00.000Z"));

    const errorOccurrence = {
      count: vi.fn(async () => 4),
      deleteMany: vi.fn(async () => ({ count: 99 })),
    };
    const event = {
      count: vi.fn(async () => 2),
      deleteMany: vi.fn(async () => ({ count: 99 })),
    };
    const session = {
      count: vi.fn(async () => 1),
      deleteMany: vi.fn(async () => ({ count: 99 })),
    };
    const errorGroup = {
      count: vi.fn(async () => 3),
      deleteMany: vi.fn(async () => ({ count: 99 })),
    };
    const queryRaw = vi.fn(async (query: unknown) => {
      const sql = sqlFromExecuteRaw(query);
      if (sql.includes("ErrorOccurrence")) return [{ count: 8n }];
      if (sql.includes("SourceMapArtifact")) return [{ count: 5n }];
      return [{ count: 0n }];
    });
    const executeRaw = vi.fn(async () => 99);
    const tx = {
      errorOccurrence,
      event,
      session,
      errorGroup,
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    };
    const prisma = {
      project: {
        findMany: vi.fn(async () => [
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
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never, { dryRun: true });

    expect(result).toEqual({
      projectsProcessed: 1,
      errorOccurrencesDeleted: 8,
      eventsDeleted: 2,
      sessionsDeleted: 1,
      errorGroupsDeleted: 3,
      sourceMapsDeleted: 5,
    });
    expect(errorOccurrence.deleteMany).not.toHaveBeenCalled();
    expect(event.deleteMany).not.toHaveBeenCalled();
    expect(session.deleteMany).not.toHaveBeenCalled();
    expect(errorGroup.deleteMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
