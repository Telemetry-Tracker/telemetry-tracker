import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildErrorGroupScopeSql,
  buildEventSessionScopeSql,
  enrichErrorListFilterForMetrics,
  errorFilterForComparedWindow,
  fetchErrorsPageSummary,
  parseErrorsMetricsAnchor,
  resolveErrorsSummaryWindow,
  shouldScopeEventsToFilteredErrors,
} from "./errors-page-summary.js";

function prismaSqlText(fragment: Prisma.Sql): string {
  const parts = fragment as unknown as { strings: string[] };
  return parts.strings.join("?");
}

describe("shouldScopeEventsToFilteredErrors", () => {
  it("scopes events when status or message search narrows error groups", () => {
    expect(shouldScopeEventsToFilteredErrors({ range: {}, status: "all" })).toBe(false);
    expect(shouldScopeEventsToFilteredErrors({ range: {}, status: "unresolved" })).toBe(
      true
    );
    expect(shouldScopeEventsToFilteredErrors({ range: {}, q: "timeout", status: "all" })).toBe(
      true
    );
  });
});

describe("buildEventSessionScopeSql", () => {
  it("includes status filters when scoping events to matching error sessions", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const until = new Date("2026-06-08T00:00:00.000Z");
    const sql = buildEventSessionScopeSql(
      { range: {}, status: "unresolved" },
      "proj-1",
      since,
      until
    );
    const text = prismaSqlText(sql);
    expect(text).toContain("EXISTS");
    expect(text).toContain('"resolved_at" IS NULL');
  });

  it("returns empty SQL when no narrowing filters apply", () => {
    const sql = buildEventSessionScopeSql(
      { range: {}, status: "all" },
      "proj-1",
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-08T00:00:00.000Z")
    );
    expect(prismaSqlText(sql)).toBe("");
  });
});

describe("parseErrorsMetricsAnchor", () => {
  it("parses ISO metricsUntil", () => {
    const iso = "2026-06-28T12:00:00.000Z";
    expect(parseErrorsMetricsAnchor(iso).toISOString()).toBe(iso);
  });

  it("falls back to now when metricsUntil is missing or invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));
    expect(parseErrorsMetricsAnchor(undefined).toISOString()).toBe(
      "2026-06-28T12:00:00.000Z"
    );
    expect(parseErrorsMetricsAnchor("not-a-date").toISOString()).toBe(
      "2026-06-28T12:00:00.000Z"
    );
    vi.useRealTimers();
  });
});

describe("default metrics window alignment", () => {
  const anchor = new Date("2026-06-28T12:00:00.000Z");

  it("uses the same bounds for summary and in-range counts", () => {
    const window = resolveErrorsSummaryWindow({}, anchor);
    const enriched = enrichErrorListFilterForMetrics(
      { range: {}, status: "all" },
      {},
      anchor
    );
    expect(enriched.occurrenceCountRange?.gte).toEqual(window.since);
    expect(enriched.occurrenceCountRange?.lte).toEqual(window.until);
  });
});

describe("buildErrorGroupScopeSql", () => {
  it("applies last_seen bounds so summary matches the issues list date filter", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const until = new Date("2026-06-08T00:00:00.000Z");
    const sql = buildErrorGroupScopeSql(
      { range: { gte: since, lte: until }, status: "all" },
      "proj-1"
    );
    const text = prismaSqlText(sql);
    expect(text).toContain('"last_seen" >= ?');
    expect(text).toContain('"last_seen" <= ?');
  });

  it("scopes platform membership to in-window occurrences instead of last_seen", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const until = new Date("2026-06-08T00:00:00.000Z");
    const sql = buildErrorGroupScopeSql(
      { range: { gte: since, lte: until }, status: "all", platform: "ios" },
      "proj-1"
    );
    const text = prismaSqlText(sql);
    expect(text).not.toContain('"last_seen"');
    expect(text).toContain('rel."platform" = ?');
    expect(text).toContain('rel."created_at" >= ?');
    expect(text).toContain('rel."created_at" <= ?');
  });

  it("uses occurrenceCountRange when list range is unbounded", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const until = new Date("2026-06-08T00:00:00.000Z");
    const sql = buildErrorGroupScopeSql(
      {
        range: {},
        occurrenceCountRange: { gte: since, lte: until },
        status: "all",
        platform: "ios",
      },
      "proj-1"
    );
    const text = prismaSqlText(sql);
    expect(text).not.toContain('"last_seen"');
    expect(text).toContain('rel."created_at" >= ?');
    expect(text).toContain('rel."created_at" <= ?');
  });

  it("applies message search on error groups", () => {
    const sql = buildErrorGroupScopeSql(
      { range: {}, q: "timeout", status: "all" },
      "proj-1"
    );
    const text = prismaSqlText(sql);
    expect(text).toContain('COALESCE("eg"."message", \'\') ILIKE ?');
    expect(text).toContain('COALESCE("eg"."fingerprint", \'\') ILIKE ?');
    expect(text).toContain(`occ."context"->>'digest'`);
  });

  it("applies multi-word q as AND across message OR fingerprint terms", () => {
    const sql = buildErrorGroupScopeSql(
      { range: {}, q: "checkout TypeError", status: "all" },
      "proj-1"
    );
    const text = prismaSqlText(sql);
    expect(text).toContain(" AND ");
    expect(text).toContain(" OR ");
    const values = (sql as unknown as { values: unknown[] }).values;
    expect(values).toContain("%checkout%");
    expect(values).toContain("%TypeError%");
  });
});

describe("resolveErrorsSummaryWindow", () => {
  const anchor = new Date("2026-06-28T12:00:00.000Z");
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to last 7 days when range has no lower bound", () => {
    vi.useFakeTimers();
    vi.setSystemTime(anchor);
    const until = new Date("2026-06-28T00:00:00.000Z");
    const w = resolveErrorsSummaryWindow({ lte: until }, anchor);

    expect(w.label).toBe("Last 7 days");
    expect(w.until.getTime()).toBe(until.getTime());
    expect(w.since.getTime()).toBe(until.getTime() - sevenDaysMs);
    expect(w.compareLabel).toBe("vs prior period");
    expect(w.previousUntil.getTime()).toBe(w.since.getTime());
    expect(w.previousSince.getTime()).toBe(w.since.getTime() - sevenDaysMs);
  });

  it("uses explicit range bounds and selected-period label", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const until = new Date("2026-06-08T00:00:00.000Z");
    const w = resolveErrorsSummaryWindow({ gte: since, lte: until }, anchor);

    expect(w.label).toBe("Selected period");
    expect(w.since).toEqual(since);
    expect(w.until).toEqual(until);
    expect(w.previousUntil.getTime()).toBe(since.getTime());
    expect(w.previousSince.getTime()).toBe(
      since.getTime() - (until.getTime() - since.getTime())
    );
  });
});

describe("enrichErrorListFilterForMetrics", () => {
  const anchor = new Date("2026-06-28T12:00:00.000Z");

  it("adds default 7-day occurrence window when list range is all-time", () => {
    const enriched = enrichErrorListFilterForMetrics(
      { range: {}, status: "all" },
      {},
      anchor
    );
    expect(enriched.occurrenceCountRange?.gte.getTime()).toBe(
      anchor.getTime() - 7 * 24 * 60 * 60 * 1000
    );
    expect(enriched.occurrenceCountRange?.lte).toEqual(anchor);
  });

  it("leaves filter unchanged when list range has a lower bound", () => {
    const since = new Date("2026-06-01T00:00:00.000Z");
    const filter = { range: { gte: since }, status: "all" as const };
    expect(enrichErrorListFilterForMetrics(filter, filter.range, anchor)).toEqual(filter);
  });
});

describe("errorFilterForComparedWindow", () => {
  const window = {
    since: new Date("2026-07-13T00:00:00.000Z"),
    until: new Date("2026-07-19T23:59:59.999Z"),
    previousSince: new Date("2026-07-06T00:00:00.000Z"),
  };

  it("spans previous+current for summary scope", () => {
    const aligned = errorFilterForComparedWindow(
      {
        range: {
          gte: new Date("2026-07-18T00:00:00.000Z"),
          lte: new Date("2026-07-19T00:00:00.000Z"),
        },
        status: "all",
        appId: "web",
      },
      window
    );
    expect(aligned.range).toEqual({
      gte: window.previousSince,
      lte: window.until,
    });
    expect(aligned.appId).toBe("web");
  });

  it("uses current window only when includePrevious is false", () => {
    const aligned = errorFilterForComparedWindow(
      { range: { gte: new Date("2026-07-18T00:00:00.000Z") }, status: "all" },
      window,
      { includePrevious: false }
    );
    expect(aligned.range).toEqual({ gte: window.since, lte: window.until });
  });
});

describe("fetchErrorsPageSummary", () => {
  it("does not call Prisma.join with an empty array when release/platform are unset", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        total_occurrences: 0n,
        total_occurrences_previous: 0n,
        affected_users: 0n,
        affected_users_previous: 0n,
        unique_groups: 0n,
        unique_groups_previous: 0n,
        resolved_groups: 0n,
        resolved_groups_previous: 0n,
        events_count: 0n,
        events_count_previous: 0n,
      },
    ]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const since = new Date("2026-07-15T00:00:00.000Z");
    const until = new Date("2026-07-16T00:00:00.000Z");
    const window = resolveErrorsSummaryWindow({ gte: since, lte: until });

    await expect(
      fetchErrorsPageSummary(prisma, { range: { gte: since, lte: until }, status: "all" }, "proj-1", window)
    ).resolves.toMatchObject({
      totalOccurrences: 0,
      eventsCount: 0,
    });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("scopes occurrences by release and platform when both filters are set", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        total_occurrences: 1n,
        total_occurrences_previous: 0n,
        affected_users: 1n,
        affected_users_previous: 0n,
        unique_groups: 1n,
        unique_groups_previous: 0n,
        resolved_groups: 0n,
        resolved_groups_previous: 0n,
        events_count: 2n,
        events_count_previous: 0n,
      },
    ]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const since = new Date("2026-07-15T00:00:00.000Z");
    const until = new Date("2026-07-16T00:00:00.000Z");
    const window = resolveErrorsSummaryWindow({ gte: since, lte: until });

    await fetchErrorsPageSummary(
      prisma,
      {
        range: { gte: since, lte: until },
        status: "all",
        release: "1.5.0",
        platform: "web",
      },
      "proj-1",
      window
    );

    const sql = queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    const text = prismaSqlText(sql);
    expect(text).toContain('TRIM(eo."release") = ?');
    expect(text).toContain('eo."platform" = ?');
  });
});
