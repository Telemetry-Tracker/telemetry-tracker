import { Prisma } from "@prisma/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildErrorGroupWhereInput,
  buildErrorOccurrenceScopeWhere,
  listScopedOccurrenceIdsForGroupId,
  parseTrendWindowParam,
  serializeErrorGroupListItem,
  isAggregateSort,
} from "./errors-list-query.js";
import { UNKNOWN_RELEASE_KEY } from "./release-key.js";

function prismaSqlText(fragment: Prisma.Sql): string {
  const parts = fragment as unknown as { strings: string[]; values: unknown[] };
  return parts.strings.join("?");
}

describe("buildErrorGroupWhereInput", () => {
  it("applies multi-word q as AND of message OR fingerprint contains", () => {
    const where = buildErrorGroupWhereInput(
      { range: {}, q: "checkout TypeError", status: "all" },
      "proj-1"
    );
    expect(where.AND).toEqual([
      {
        OR: [
          { message: { contains: "checkout", mode: "insensitive" } },
          { fingerprint: { contains: "checkout", mode: "insensitive" } },
          {
            occurrences_list: {
              some: {
                context: { path: ["digest"], string_contains: "checkout" },
              },
            },
          },
        ],
      },
      {
        OR: [
          { message: { contains: "TypeError", mode: "insensitive" } },
          { fingerprint: { contains: "TypeError", mode: "insensitive" } },
          {
            occurrences_list: {
              some: {
                context: { path: ["digest"], string_contains: "TypeError" },
              },
            },
          },
        ],
      },
    ]);
  });
});

describe("buildErrorOccurrenceScopeWhere", () => {
  it("returns empty object when no scope is set", () => {
    expect(buildErrorOccurrenceScopeWhere({})).toEqual({});
  });

  it("matches Unknown via null / blank / sentinel (not exact __unknown__ only)", () => {
    expect(buildErrorOccurrenceScopeWhere({ release: UNKNOWN_RELEASE_KEY })).toEqual({
      OR: [{ release: null }, { release: "" }, { release: UNKNOWN_RELEASE_KEY }],
    });
  });

  it("uses trimmed equality for known releases and keeps platform/window", () => {
    const gte = new Date("2026-06-01T00:00:00.000Z");
    const lte = new Date("2026-06-08T00:00:00.000Z");
    expect(
      buildErrorOccurrenceScopeWhere({
        release: "  1.2.3  ",
        platform: "ios",
        gte,
        lte,
      })
    ).toEqual({
      platform: "ios",
      release: "1.2.3",
      created_at: { gte, lte },
    });
  });
});

describe("listScopedOccurrenceIdsForGroupId", () => {
  it("returns empty without querying when scope is unset", async () => {
    const prisma = { $queryRaw: vi.fn() };
    const ids = await listScopedOccurrenceIdsForGroupId(
      prisma as never,
      "eg_1",
      "proj_1",
      {},
      50
    );
    expect(ids).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("queries with releaseFilterMatchSql-compatible scope for Unknown", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "o1" }, { id: "o2" }]),
    };
    const ids = await listScopedOccurrenceIdsForGroupId(
      prisma as never,
      "eg_1",
      "proj_1",
      { release: UNKNOWN_RELEASE_KEY },
      50
    );
    expect(ids).toEqual(["o1", "o2"]);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    const sql = prisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    const text = prismaSqlText(sql);
    expect(text).toContain("ErrorOccurrence");
    expect(text).toContain("ErrorGroup");
    expect(text).toContain("project_id");
    expect(text).toContain("ORDER BY");
    expect(text).toContain("TRIM");
  });
});

describe("isAggregateSort", () => {
  it("routes occurrences sort through the in-range aggregate path", () => {
    expect(isAggregateSort("occurrences")).toBe(true);
    expect(isAggregateSort("last_seen")).toBe(false);
  });
});

describe("serializeErrorGroupListItem", () => {
  const baseRow = {
    id: "eg_1",
    fingerprint: "fp",
    message: "boom",
    top_stack: null,
    app: "web",
    environment: "production",
    occurrences: 42,
    first_seen: new Date("2026-06-01T00:00:00.000Z"),
    last_seen: new Date("2026-06-08T00:00:00.000Z"),
    resolved_at: null,
  };

  it("defaults occurrences_in_range to zero when no in-range aggregate exists", () => {
    const item = serializeErrorGroupListItem(baseRow);
    expect(item.occurrences).toBe(42);
    expect(item.occurrences_in_range).toBe(0);
  });

  it("preserves explicit zero in-range counts", () => {
    const item = serializeErrorGroupListItem({
      ...baseRow,
      occurrences_in_range: 0,
    });
    expect(item.occurrences_in_range).toBe(0);
  });

  it("includes error type and sparkline defaults", () => {
    const item = serializeErrorGroupListItem({
      ...baseRow,
      message: "TypeError: boom",
    });
    expect(item.error_type).toBe("TypeError");
    expect(item.sparkline).toEqual([]);
  });
});

describe("parseTrendWindowParam", () => {
  const anchor = new Date("2026-06-28T12:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to 24h", () => {
    vi.useFakeTimers();
    vi.setSystemTime(anchor);
    const r = parseTrendWindowParam({}, anchor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trend.key).toBe("24h");
    expect(r.trend.durationMs).toBe(24 * 60 * 60 * 1000);
  });

  it("accepts 14d and custom 8w", () => {
    vi.useFakeTimers();
    vi.setSystemTime(anchor);
    const r14 = parseTrendWindowParam({ trendWindow: "14d" }, anchor);
    expect(r14.ok).toBe(true);
    if (!r14.ok) return;
    expect(r14.trend.durationMs).toBe(14 * 24 * 60 * 60 * 1000);

    const r8w = parseTrendWindowParam({ trendWindow: "8w" }, anchor);
    expect(r8w.ok).toBe(true);
    if (!r8w.ok) return;
    expect(r8w.trend.durationMs).toBe(8 * 7 * 24 * 60 * 60 * 1000);
  });

  it("rejects all time", () => {
    const r = parseTrendWindowParam({ trendWindow: "all" }, anchor);
    expect(r.ok).toBe(false);
  });

  it("parses absolute trend range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(anchor);
    const r = parseTrendWindowParam(
      { trendFrom: "2026-03-01", trendTo: "2026-03-08" },
      anchor
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trend.key).toBe("absolute");
    expect(r.trend.durationMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});
