import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { parseGlobalSearchQuery } from "./global-search-query.js";
import {
  executeGlobalSearch,
  globalSearchReleaseActivityBounds,
  globalSearchReleaseActivityTimeSql,
  globalSearchSessionEnvReleaseSql,
  globalSearchSessionReleaseSql,
  hasGlobalSearchTimeSignal,
} from "./global-search.js";
import { UNKNOWN_RELEASE_KEY } from "./release-key.js";

function prismaSqlText(fragment: Prisma.Sql): string {
  const parts = fragment as unknown as { strings: string[]; values: unknown[] };
  return parts.strings.join("?");
}

function prismaSqlValues(fragment: Prisma.Sql): unknown[] {
  const parts = fragment as unknown as { values: unknown[] };
  return parts.values;
}

describe("hasGlobalSearchTimeSignal", () => {
  const gte = new Date("2026-07-01T00:00:00.000Z");
  const lte = new Date("2026-07-08T00:00:00.000Z");

  it("is false when no range or metrics windows are set", () => {
    expect(hasGlobalSearchTimeSignal({ range: {} })).toBe(false);
  });

  it("is true for parsed range bounds", () => {
    expect(hasGlobalSearchTimeSignal({ range: { gte } })).toBe(true);
    expect(hasGlobalSearchTimeSignal({ range: { lte } })).toBe(true);
  });

  it("is true for route metrics windows when range is empty (all-time / range:none)", () => {
    expect(
      hasGlobalSearchTimeSignal({
        range: {},
        sessionStartedAt: { gte, lte },
      })
    ).toBe(true);
    expect(
      hasGlobalSearchTimeSignal({
        range: {},
        eventCreatedAt: { gte, lte },
      })
    ).toBe(true);
    expect(
      hasGlobalSearchTimeSignal({
        range: {},
        errorOccurrenceRange: { gte, lte },
      })
    ).toBe(true);
  });
});

describe("executeGlobalSearch issues time window", () => {
  const gte = new Date("2026-07-01T00:00:00.000Z");
  const lte = new Date("2026-07-08T00:00:00.000Z");

  it("applies errorOccurrenceRange to last_seen when range is empty (no release/platform)", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;

    await executeGlobalSearch(
      prisma,
      "proj-1",
      parseGlobalSearchQuery("range:all"),
      {
        range: {},
        sessionStartedAt: { gte, lte },
        eventCreatedAt: { gte, lte },
        errorOccurrenceRange: { gte, lte },
      }
    );

    const errorSql = queryRaw.mock.calls
      .map((call) => call[0] as Prisma.Sql)
      .find((sql) => {
        const text = prismaSqlText(sql);
        return text.includes('"ErrorGroup"') && text.includes('eg."last_seen"');
      });
    expect(errorSql).toBeDefined();
    const text = prismaSqlText(errorSql!);
    expect(text).toContain('eg."last_seen" >=');
    expect(text).toContain('eg."last_seen" <=');
    expect(prismaSqlValues(errorSql!)).toEqual(
      expect.arrayContaining([gte, lte])
    );
    expect(text).not.toContain("ErrorOccurrence");
  });

  it("still uses occurrence EXISTS with errorOccurrenceRange when release is scoped", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;

    await executeGlobalSearch(
      prisma,
      "proj-1",
      parseGlobalSearchQuery("release:1.0.0"),
      {
        range: {},
        release: "1.0.0",
        errorOccurrenceRange: { gte, lte },
      }
    );

    const errorSql = queryRaw.mock.calls
      .map((call) => call[0] as Prisma.Sql)
      .find((sql) => prismaSqlText(sql).includes('"ErrorGroup"'));
    expect(errorSql).toBeDefined();
    const text = prismaSqlText(errorSql!);
    expect(text).toContain("ErrorOccurrence");
    expect(text).toContain('rel."created_at"');
    expect(prismaSqlValues(errorSql!)).toEqual(
      expect.arrayContaining([gte, lte])
    );
  });
});

describe("executeGlobalSearch users ordering", () => {
  it("orders distinct identities by latest session activity, not alphabetically", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const gte = new Date("2026-07-01T00:00:00.000Z");
    const lte = new Date("2026-07-08T00:00:00.000Z");

    await executeGlobalSearch(
      prisma,
      "proj-1",
      parseGlobalSearchQuery("user:alice"),
      {
        range: {},
        sessionStartedAt: { gte, lte },
        eventCreatedAt: { gte, lte },
        user: "alice",
      }
    );

    const userSql = queryRaw.mock.calls
      .map((call) => call[0] as Prisma.Sql)
      .find((sql) => prismaSqlText(sql).includes("DISTINCT ON"));
    expect(userSql).toBeDefined();
    const text = prismaSqlText(userSql!);
    expect(text).toMatch(/ORDER BY started_at DESC\s*LIMIT/i);
    expect(text).not.toMatch(/ORDER BY identity ASC/i);
  });
});

describe("executeGlobalSearch error digest", () => {
  it("matches occurrence context.digest as well as message and fingerprint", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;

    await executeGlobalSearch(
      prisma,
      "proj-1",
      parseGlobalSearchQuery("2474318592"),
      { range: {} }
    );

    const errorSql = queryRaw.mock.calls
      .map((call) => call[0] as Prisma.Sql)
      .find((sql) => prismaSqlText(sql).includes('"ErrorGroup"'));
    expect(errorSql).toBeDefined();
    const text = prismaSqlText(errorSql!);
    expect(text).toContain('eg."message"');
    expect(text).toContain('eg."fingerprint"');
    expect(text).toContain(`occ."context"->>'digest'`);
    expect(text).toContain('"ErrorOccurrence"');
    expect(prismaSqlValues(errorSql!)).toEqual(
      expect.arrayContaining(["%2474318592%"])
    );
  });
});

describe("globalSearchReleaseActivityBounds", () => {
  const gte = new Date("2026-07-01T00:00:00.000Z");
  const lte = new Date("2026-07-08T00:00:00.000Z");
  const rangeGte = new Date("2026-06-01T00:00:00.000Z");
  const rangeLte = new Date("2026-06-30T00:00:00.000Z");

  it("returns empty bounds when no window is set", () => {
    expect(globalSearchReleaseActivityBounds("event", { range: {} })).toEqual({});
    expect(globalSearchReleaseActivityBounds("session", { range: {} })).toEqual({});
    expect(globalSearchReleaseActivityBounds("error", { range: {} })).toEqual({});
  });

  it("prefers entity windows over range for each source", () => {
    const scope = {
      range: { gte: rangeGte, lte: rangeLte },
      eventCreatedAt: { gte, lte },
      sessionStartedAt: { gte, lte },
      errorOccurrenceRange: { gte, lte },
    };
    expect(globalSearchReleaseActivityBounds("event", scope)).toEqual({ gte, lte });
    expect(globalSearchReleaseActivityBounds("session", scope)).toEqual({ gte, lte });
    expect(globalSearchReleaseActivityBounds("error", scope)).toEqual({ gte, lte });
  });

  it("falls back to range when entity windows are absent", () => {
    const scope = { range: { gte: rangeGte, lte: rangeLte } };
    expect(globalSearchReleaseActivityBounds("event", scope)).toEqual({
      gte: rangeGte,
      lte: rangeLte,
    });
    expect(globalSearchReleaseActivityBounds("session", scope)).toEqual({
      gte: rangeGte,
      lte: rangeLte,
    });
    expect(globalSearchReleaseActivityBounds("error", scope)).toEqual({
      gte: rangeGte,
      lte: rangeLte,
    });
  });

  it("fills missing error/event upper bound from sessionStartedAt", () => {
    const from = new Date("2026-06-15T00:00:00.000Z");
    const sessionGte = new Date("2026-07-01T00:00:00.000Z");
    const sessionLte = new Date("2026-07-08T00:00:00.000Z");
    const scope = {
      range: { gte: from },
      eventCreatedAt: { gte: from },
      errorOccurrenceRange: { gte: from },
      sessionStartedAt: { gte: sessionGte, lte: sessionLte },
    };
    expect(globalSearchReleaseActivityBounds("error", scope)).toEqual({
      gte: from,
      lte: sessionLte,
    });
    expect(globalSearchReleaseActivityBounds("event", scope)).toEqual({
      gte: from,
      lte: sessionLte,
    });
    expect(globalSearchReleaseActivityBounds("session", scope)).toEqual({
      gte: sessionGte,
      lte: sessionLte,
    });
  });
});

describe("globalSearchReleaseActivityTimeSql", () => {
  const gte = new Date("2026-07-01T00:00:00.000Z");
  const lte = new Date("2026-07-08T00:00:00.000Z");

  it("returns null when no window is set", () => {
    expect(globalSearchReleaseActivityTimeSql("event", { range: {} })).toBeNull();
  });

  it("filters events by created_at within the window", () => {
    const sql = globalSearchReleaseActivityTimeSql("event", {
      range: {},
      eventCreatedAt: { gte, lte },
    });
    expect(sql).not.toBeNull();
    expect(prismaSqlText(sql!)).toContain('e."created_at"');
    expect(prismaSqlValues(sql!)).toEqual([gte, lte]);
  });

  it("filters sessions by started_at within the window", () => {
    const sql = globalSearchReleaseActivityTimeSql("session", {
      range: {},
      sessionStartedAt: { gte, lte },
    });
    expect(sql).not.toBeNull();
    expect(prismaSqlText(sql!)).toContain('s."started_at"');
    expect(prismaSqlValues(sql!)).toEqual([gte, lte]);
  });

  it("filters errors by occurrence created_at within the window", () => {
    const sql = globalSearchReleaseActivityTimeSql("error", {
      range: {},
      errorOccurrenceRange: { gte, lte },
    });
    expect(sql).not.toBeNull();
    expect(prismaSqlText(sql!)).toContain('eo."created_at"');
    expect(prismaSqlValues(sql!)).toEqual([gte, lte]);
  });

  it("supports open-ended range fallback (gte only)", () => {
    const sql = globalSearchReleaseActivityTimeSql("event", {
      range: { gte },
    });
    expect(sql).not.toBeNull();
    expect(prismaSqlText(sql!)).toContain(">=");
    expect(prismaSqlText(sql!)).not.toContain("<=");
    expect(prismaSqlValues(sql!)).toEqual([gte]);
  });
});

describe("globalSearchSessionEnvReleaseSql", () => {
  it("returns null when neither environment nor release is set", () => {
    expect(globalSearchSessionEnvReleaseSql("proj-1", {})).toBeNull();
  });

  it("uses effective-release COALESCE with event fallback for known keys", () => {
    const sql = globalSearchSessionReleaseSql("proj-1", {
      release: "1.2.0",
      platform: "ios",
    });
    expect(sql).not.toBeNull();
    const text = prismaSqlText(sql!);
    expect(text).toContain("COALESCE");
    expect(text).toContain('"Event"');
    expect(prismaSqlValues(sql!)).toContain("1.2.0");
    expect(prismaSqlValues(sql!)).toContain("ios");
  });

  it("includes NULL-env event fallback for environment-only filters", () => {
    const sql = globalSearchSessionEnvReleaseSql("proj-1", {
      environment: "production",
      sessionStartedAt: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lte: new Date("2026-01-08T00:00:00.000Z"),
      },
    });
    expect(sql).not.toBeNull();
    const text = prismaSqlText(sql!);
    expect(text).toContain("IS NULL");
    expect(text).toContain('"Event"');
    expect(prismaSqlValues(sql!)).toContain("production");
  });

  it("requires exact Session.environment when release is also set", () => {
    const sql = globalSearchSessionEnvReleaseSql("proj-1", {
      release: "1.2.0",
      environment: "production",
      platform: "web",
    });
    expect(sql).not.toBeNull();
    const text = prismaSqlText(sql!);
    expect(text).toContain("COALESCE");
    // Combined clause: env equality AND effective release (no NULL-env OR branch).
    expect(text).not.toMatch(/environment" IS NULL/);
    expect(prismaSqlValues(sql!)).toEqual(
      expect.arrayContaining(["proj-1", "production", "web", "1.2.0"])
    );
  });

  it("matches Unknown via effective key IS NULL", () => {
    const sql = globalSearchSessionReleaseSql("proj-1", {
      release: UNKNOWN_RELEASE_KEY,
    });
    expect(sql).not.toBeNull();
    expect(prismaSqlText(sql!)).toContain("IS NULL");
  });
});
