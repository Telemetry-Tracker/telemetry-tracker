import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanTier } from "@prisma/client";
import { runRetentionSweep } from "./retention.js";

function sqlFromExecuteRaw(query: unknown): string {
  if (typeof query !== "object" || query === null || !("strings" in query)) {
    return String(query);
  }
  return (query as { strings: string[] }).strings.join("");
}

type OrgFields = {
  plan_tier: PlanTier;
  stripe_subscription_status: string | null;
  deleted_at: Date | null;
};

type ProjectRow = {
  id: string;
  organization: OrgFields;
};

const freeOrg: OrgFields = {
  plan_tier: PlanTier.FREE,
  stripe_subscription_status: null,
  deleted_at: null,
};

function mockFindMany(projects: ProjectRow[]) {
  const sorted = [...projects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return vi.fn(
    async ({
      take,
      where,
    }: {
      take?: number;
      where?: { deleted_at?: null; id?: { gt?: string } };
    }) => {
      const gt = where?.id?.gt;
      let rows = sorted;
      if (gt) rows = rows.filter((p) => p.id > gt);
      return rows.slice(0, take ?? rows.length);
    }
  );
}

function liveTx() {
  const executeRaw = vi.fn(async (query: unknown) => {
    if (sqlFromExecuteRaw(query).includes("SourceMapArtifact")) return 3;
    return 0;
  });
  return {
    errorOccurrence: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    event: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    session: {
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return { count: "ended_at" in where ? 1 : 2 };
      }),
    },
    errorGroup: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $executeRaw: executeRaw,
  };
}

describe("runRetentionSweep", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("expires sessions by end time so open long-running sessions are retained", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T10:00:00.000Z"));

    const cutoff = new Date("2026-04-22T10:00:00.000Z");
    const tx = liveTx();
    const prisma = {
      project: {
        findMany: mockFindMany([{ id: "project-1", organization: freeOrg }]),
      },
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never);

    expect(result.sessionsDeleted).toBe(1);
    expect(result.sourceMapsDeleted).toBe(3);
    expect(result.projectsFailed).toBe(0);
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: {
        project_id: "project-1",
        ended_at: { lt: cutoff },
      },
    });

    const mapDeleteSql = tx.$executeRaw.mock.calls
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
        findMany: mockFindMany([{ id: "project-1", organization: freeOrg }]),
      },
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never);

    expect(result.sourceMapsDeleted).toBe(0);
    expect(result.projectsFailed).toBe(0);
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
        findMany: mockFindMany([{ id: "project-1", organization: freeOrg }]),
      },
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never, { dryRun: true });

    expect(result).toEqual({
      projectsProcessed: 1,
      projectsFailed: 0,
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

  it("loads projects in keyset batches without skipping or double-processing", async () => {
    const tx = liveTx();
    const findMany = mockFindMany([
      { id: "project-a", organization: freeOrg },
      { id: "project-b", organization: freeOrg },
      { id: "project-c", organization: freeOrg },
    ]);
    const prisma = {
      project: { findMany },
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await runRetentionSweep(prisma as never, { projectBatchSize: 2 });

    expect(result.projectsProcessed).toBe(3);
    expect(result.projectsFailed).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ take: 2, orderBy: { id: "asc" } });
    expect(findMany.mock.calls[0]?.[0].where).toEqual({ deleted_at: null });
    expect(findMany.mock.calls[1]?.[0].where).toEqual({
      deleted_at: null,
      id: { gt: "project-b" },
    });
    const processedIds = tx.session.deleteMany.mock.calls.map(
      ([args]) => (args as { where: { project_id: string } }).where.project_id
    );
    expect(processedIds).toEqual(["project-a", "project-b", "project-c"]);
  });

  it("continues after one project fails and still processes later projects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = liveTx();
    let txCalls = 0;
    const prisma = {
      project: {
        findMany: mockFindMany([
          { id: "project-a", organization: freeOrg },
          { id: "project-b", organization: freeOrg },
          { id: "project-c", organization: freeOrg },
        ]),
      },
      $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => {
        txCalls += 1;
        if (txCalls === 2) {
          throw new Error("simulated project-b failure");
        }
        return fn(tx);
      }),
    };

    const result = await runRetentionSweep(prisma as never, { projectBatchSize: 1 });

    expect(result.projectsProcessed).toBe(2);
    expect(result.projectsFailed).toBe(1);
    expect(result.sessionsDeleted).toBe(2);
    expect(txCalls).toBe(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
      projectId: string;
      error: string;
      job: string;
    };
    expect(logged.job).toBe("retention");
    expect(logged.projectId).toBe("project-b");
    expect(logged.error).toBe("simulated project-b failure");
    expect(logged).not.toHaveProperty("databaseUrl");
  });
});
