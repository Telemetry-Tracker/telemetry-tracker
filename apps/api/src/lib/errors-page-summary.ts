/**
 * Errors list page summary KPIs and shared occurrence-scope SQL.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { errorGroupFreeTextMatchSql } from "./list-query-helpers.js";
import { resolveCompareWindow } from "./overview-stats.js";
import type { ErrorListFilterInput } from "./errors-list-query.js";
import { releaseFilterMatchSql } from "./release-key.js";

export type ErrorsPageSummary = {
  window: {
    since: string;
    until: string;
    label: string;
    compareLabel: string;
  };
  totalOccurrences: number;
  totalOccurrencesPrevious: number;
  affectedUsers: number;
  affectedUsersPrevious: number;
  uniqueGroups: number;
  uniqueGroupsPrevious: number;
  resolvedGroups: number;
  resolvedGroupsPrevious: number;
  eventsCount: number;
  eventsCountPrevious: number;
  errorRatePct: number;
  errorRatePctPrevious: number;
};

export type ResolvedSummaryWindow = {
  since: Date;
  until: Date;
  previousSince: Date;
  previousUntil: Date;
  label: string;
  compareLabel: string;
};

const DEFAULT_SUMMARY_MS = 7 * 24 * 60 * 60 * 1000;

/** Shared anchor for default 7-day metrics when list range is all-time. */
export function parseErrorsMetricsAnchor(value: string | undefined): Date {
  const raw = value?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/** Resolve KPI window from list filters; defaults to last 7 days when range is all-time. */
export function resolveErrorsSummaryWindow(
  range: { gte?: Date; lte?: Date },
  anchor: Date = new Date()
): ResolvedSummaryWindow {
  const until = range.lte ?? anchor;
  const since =
    range.gte ?? new Date(until.getTime() - DEFAULT_SUMMARY_MS);
  const durationMs = Math.max(until.getTime() - since.getTime(), 1);
  const { previousSince, previousUntil } = resolveCompareWindow(
    durationMs,
    "previous",
    since,
    until
  );
  const prevUntil = previousUntil ?? since;
  const label = range.gte
    ? "Selected period"
    : "Last 7 days";
  return {
    since,
    until,
    previousSince,
    previousUntil: prevUntil,
    label,
    compareLabel: "vs prior period",
  };
}

export function buildErrorGroupScopeSql(
  f: ErrorListFilterInput,
  projectId: string,
  egAlias = "eg"
): Prisma.Sql {
  const eg = Prisma.raw(`"${egAlias}"`);
  const parts: Prisma.Sql[] = [Prisma.sql`${eg}."project_id" = ${projectId}`];
  if (f.appId) parts.push(Prisma.sql`${eg}."app" = ${f.appId}`);
  if (f.environment) parts.push(Prisma.sql`${eg}."environment" = ${f.environment}`);
  const textSql = errorGroupFreeTextMatchSql(
    f.q,
    Prisma.sql`${eg}."message"`,
    Prisma.sql`${eg}."fingerprint"`,
    Prisma.sql`${eg}."id"`
  );
  if (textSql) parts.push(textSql);
  if (f.status === "unresolved") parts.push(Prisma.sql`${eg}."resolved_at" IS NULL`);
  if (f.status === "resolved") parts.push(Prisma.sql`${eg}."resolved_at" IS NOT NULL`);
  if (f.release || f.platform) {
    const gte = f.range.gte ?? f.occurrenceCountRange?.gte;
    const lte = f.range.lte ?? f.occurrenceCountRange?.lte;
    const scopeParts: Prisma.Sql[] = [];
    if (f.release) scopeParts.push(releaseFilterMatchSql(Prisma.sql`rel."release"`, f.release));
    if (f.platform) scopeParts.push(Prisma.sql`rel."platform" = ${f.platform}`);
    if (gte) scopeParts.push(Prisma.sql`rel."created_at" >= ${gte}`);
    if (lte) scopeParts.push(Prisma.sql`rel."created_at" <= ${lte}`);
    parts.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "ErrorOccurrence" rel
        WHERE rel."error_group_id" = ${eg}."id"
          AND ${Prisma.join(scopeParts, " AND ")}
      )`
    );
  } else {
    if (f.range.gte) parts.push(Prisma.sql`${eg}."last_seen" >= ${f.range.gte}`);
    if (f.range.lte) parts.push(Prisma.sql`${eg}."last_seen" <= ${f.range.lte}`);
  }
  return Prisma.join(parts, " AND ");
}

export function buildErrorOccurrenceFilterSql(
  f: ErrorListFilterInput,
  projectId: string,
  alias: "eo" | "o" = "eo",
  opts?: { applyOccurrenceRange?: boolean }
): Prisma.Sql {
  const t = alias;
  const applyOccurrenceRange = opts?.applyOccurrenceRange !== false;
  const parts: Prisma.Sql[] = [buildErrorGroupScopeSql(f, projectId, "eg")];
  if (applyOccurrenceRange && f.range.gte) {
    parts.push(Prisma.sql`${Prisma.raw(`"${t}"."created_at"`)} >= ${f.range.gte}`);
  }
  if (applyOccurrenceRange && f.range.lte) {
    parts.push(Prisma.sql`${Prisma.raw(`"${t}"."created_at"`)} <= ${f.range.lte}`);
  }
  return Prisma.join(parts, " AND ");
}

export function enrichErrorListFilterForMetrics(
  filter: ErrorListFilterInput,
  range: { gte?: Date; lte?: Date },
  anchor: Date = new Date()
): ErrorListFilterInput {
  if (range.gte || filter.occurrenceCountRange) return filter;
  const w = resolveErrorsSummaryWindow(range, anchor);
  return {
    ...filter,
    occurrenceCountRange: { gte: w.since, lte: w.until },
  };
}

/**
 * Align list filter.range with a summary/analytics window so group/occurrence
 * scope SQL cannot clip KPI or chart bounds when compare presets expand the
 * window beyond the page's list range (#495).
 */
export function errorFilterForComparedWindow(
  filter: ErrorListFilterInput,
  window: Pick<ResolvedSummaryWindow, "since" | "until" | "previousSince">,
  opts?: { includePrevious?: boolean }
): ErrorListFilterInput {
  const includePrevious = opts?.includePrevious !== false;
  return {
    ...filter,
    range: {
      gte: includePrevious ? window.previousSince : window.since,
      lte: window.until,
    },
  };
}

export function shouldScopeEventsToFilteredErrors(f: ErrorListFilterInput): boolean {
  return (f.q != null && f.q.trim() !== "") || f.status !== "all";
}

export function buildEventSessionScopeSql(
  f: ErrorListFilterInput,
  projectId: string,
  previousSince: Date,
  until: Date
): Prisma.Sql {
  if (!shouldScopeEventsToFilteredErrors(f)) return Prisma.empty;
  return Prisma.sql`AND EXISTS (
      SELECT 1
      FROM "ErrorOccurrence" seo
      INNER JOIN "ErrorGroup" seg ON seg."id" = seo."error_group_id"
      WHERE ${buildErrorGroupScopeSql(f, projectId, "seg")}
        ${f.release ? Prisma.sql`AND ${releaseFilterMatchSql(Prisma.sql`seo."release"`, f.release)}` : Prisma.empty}
        ${f.platform ? Prisma.sql`AND seo."platform" = ${f.platform}` : Prisma.empty}
        AND seo."created_at" >= ${previousSince}
        AND seo."created_at" <= ${until}
        AND (
          (
            e."session_id" IS NOT NULL
            AND TRIM(e."session_id") <> ''
            AND seo."session_id" = e."session_id"
          )
          OR (
            e."user_id" IS NOT NULL
            AND TRIM(e."user_id") <> ''
            AND seo."user_id" = e."user_id"
          )
          OR (
            e."anonymous_id" IS NOT NULL
            AND TRIM(e."anonymous_id") <> ''
            AND seo."anonymous_id" = e."anonymous_id"
          )
        )
    )`;
}

export async function fetchErrorsPageSummary(
  prisma: PrismaClient,
  f: ErrorListFilterInput,
  projectId: string,
  window: ResolvedSummaryWindow
): Promise<ErrorsPageSummary> {
  const { since, until, previousSince, previousUntil } = window;

  const eventParts: Prisma.Sql[] = [Prisma.sql`e."project_id" = ${projectId}`];
  if (f.appId) eventParts.push(Prisma.sql`e."app" = ${f.appId}`);
  if (f.environment) eventParts.push(Prisma.sql`e."environment" = ${f.environment}`);
  if (f.release) eventParts.push(releaseFilterMatchSql(Prisma.sql`e."release"`, f.release));
  if (f.platform) eventParts.push(Prisma.sql`e."platform" = ${f.platform}`);
  const eventFilter = Prisma.join(eventParts, " AND ");
  const occurrenceScopeParts: Prisma.Sql[] = [];
  if (f.release) occurrenceScopeParts.push(releaseFilterMatchSql(Prisma.sql`eo."release"`, f.release));
  if (f.platform) occurrenceScopeParts.push(Prisma.sql`eo."platform" = ${f.platform}`);
  // Prisma.join throws on an empty array — only join when release/platform filters exist.
  const occurrenceReleaseClause =
    occurrenceScopeParts.length > 0
      ? Prisma.sql`AND ${Prisma.join(occurrenceScopeParts, " AND ")}`
      : Prisma.empty;
  const groupScopeSql = buildErrorGroupScopeSql(f, projectId, "eg");
  const eventSessionScope = buildEventSessionScopeSql(
    f,
    projectId,
    previousSince,
    until
  );

  const rows = await prisma.$queryRaw<
    [
      {
        total_occurrences: bigint;
        total_occurrences_previous: bigint;
        affected_users: bigint;
        affected_users_previous: bigint;
        unique_groups: bigint;
        unique_groups_previous: bigint;
        resolved_groups: bigint;
        resolved_groups_previous: bigint;
        events_count: bigint;
        events_count_previous: bigint;
      },
    ]
  >(Prisma.sql`
    WITH scoped AS (
      SELECT
        eo."id",
        eo."error_group_id",
        eo."created_at",
        eo."user_id",
        eo."anonymous_id",
        eo."session_id",
        eg."resolved_at"
      FROM "ErrorOccurrence" eo
      INNER JOIN "ErrorGroup" eg ON eg."id" = eo."error_group_id"
      WHERE ${groupScopeSql}
        ${occurrenceReleaseClause}
        AND eo."created_at" >= ${previousSince}
        AND eo."created_at" <= ${until}
    ),
    events AS (
      SELECT e."created_at"
      FROM "Event" e
      WHERE ${eventFilter}
        ${eventSessionScope}
        AND e."created_at" >= ${previousSince}
        AND e."created_at" <= ${until}
    )
    SELECT
      COUNT(*) FILTER (
        WHERE s."created_at" >= ${since} AND s."created_at" <= ${until}
      )::bigint AS total_occurrences,
      COUNT(*) FILTER (
        WHERE s."created_at" >= ${previousSince} AND s."created_at" < ${previousUntil}
      )::bigint AS total_occurrences_previous,
      COUNT(DISTINCT CASE
        WHEN s."created_at" >= ${since} AND s."created_at" <= ${until}
        THEN COALESCE(
          NULLIF(TRIM(COALESCE(s."user_id", '')), ''),
          NULLIF(TRIM(COALESCE(s."anonymous_id", '')), ''),
          NULLIF(TRIM(COALESCE(s."session_id", '')), '')
        )
      END)::bigint AS affected_users,
      COUNT(DISTINCT CASE
        WHEN s."created_at" >= ${previousSince} AND s."created_at" < ${previousUntil}
        THEN COALESCE(
          NULLIF(TRIM(COALESCE(s."user_id", '')), ''),
          NULLIF(TRIM(COALESCE(s."anonymous_id", '')), ''),
          NULLIF(TRIM(COALESCE(s."session_id", '')), '')
        )
      END)::bigint AS affected_users_previous,
      COUNT(DISTINCT CASE
        WHEN s."created_at" >= ${since} AND s."created_at" <= ${until}
        THEN s."error_group_id"
      END)::bigint AS unique_groups,
      COUNT(DISTINCT CASE
        WHEN s."created_at" >= ${previousSince} AND s."created_at" < ${previousUntil}
        THEN s."error_group_id"
      END)::bigint AS unique_groups_previous,
      COUNT(DISTINCT CASE
        WHEN s."created_at" >= ${since} AND s."created_at" <= ${until}
          AND s."resolved_at" IS NOT NULL
        THEN s."error_group_id"
      END)::bigint AS resolved_groups,
      COUNT(DISTINCT CASE
        WHEN s."created_at" >= ${previousSince} AND s."created_at" < ${previousUntil}
          AND s."resolved_at" IS NOT NULL
        THEN s."error_group_id"
      END)::bigint AS resolved_groups_previous,
      (SELECT COUNT(*)::bigint FROM events ev
        WHERE ev."created_at" >= ${since} AND ev."created_at" <= ${until}
      ) AS events_count,
      (SELECT COUNT(*)::bigint FROM events ev
        WHERE ev."created_at" >= ${previousSince} AND ev."created_at" < ${previousUntil}
      ) AS events_count_previous
    FROM scoped s
  `);

  const row = rows[0];
  const totalOccurrences = Number(row?.total_occurrences ?? 0);
  const totalOccurrencesPrevious = Number(row?.total_occurrences_previous ?? 0);
  const eventsCount = Number(row?.events_count ?? 0);
  const eventsCountPrevious = Number(row?.events_count_previous ?? 0);

  const total = totalOccurrences + eventsCount;
  const totalPrev = totalOccurrencesPrevious + eventsCountPrevious;
  const errorRatePct = total > 0 ? (totalOccurrences / total) * 100 : 0;
  const errorRatePctPrevious =
    totalPrev > 0 ? (totalOccurrencesPrevious / totalPrev) * 100 : 0;

  return {
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
      label: window.label,
      compareLabel: window.compareLabel,
    },
    totalOccurrences,
    totalOccurrencesPrevious,
    affectedUsers: Number(row?.affected_users ?? 0),
    affectedUsersPrevious: Number(row?.affected_users_previous ?? 0),
    uniqueGroups: Number(row?.unique_groups ?? 0),
    uniqueGroupsPrevious: Number(row?.unique_groups_previous ?? 0),
    resolvedGroups: Number(row?.resolved_groups ?? 0),
    resolvedGroupsPrevious: Number(row?.resolved_groups_previous ?? 0),
    eventsCount,
    eventsCountPrevious,
    errorRatePct,
    errorRatePctPrevious,
  };
}
