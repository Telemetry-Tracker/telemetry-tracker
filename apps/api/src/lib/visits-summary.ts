/**
 * Visits overview: one visit is one session. Aggregates duration, location,
 * device, screens, and actions for the selected window.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import {
  SESSION_PAGE_EVENT_NAMES,
  listSessionsEnriched,
  serializeSessionListItem,
} from "./sessions-list-query.js";
import {
  sessionFilterSql,
  type ResolvedSummaryWindow,
  type SessionListFilterInput,
} from "./sessions-page-summary.js";

export type VisitBreakdownRow = {
  label: string;
  count: number;
  sharePct: number;
};

export type VisitScreenRow = {
  name: string;
  views: number;
  visits: number;
};

export type VisitActionRow = {
  name: string;
  count: number;
  visits: number;
};

export type VisitsSummary = {
  window: {
    since: string;
    until: string;
    label: string;
  };
  visits: number;
  uniqueVisitors: number;
  avgDurationSec: number;
  medianDurationSec: number;
  pagesPerVisit: number;
  eventsPerVisit: number;
  /** Share of visits that opened at most one screen. */
  singleScreenPct: number;
  countries: VisitBreakdownRow[];
  browsers: VisitBreakdownRow[];
  operatingSystems: VisitBreakdownRow[];
  platforms: VisitBreakdownRow[];
  topScreens: VisitScreenRow[];
  topActions: VisitActionRow[];
  recent: Record<string, unknown>[];
};

export function sharePct(count: number, total: number): number {
  if (total <= 0 || count <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function round1(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function sessionBoundsSql(gte: Date, lte: Date): Prisma.Sql {
  return Prisma.sql`s."started_at" >= ${gte} AND s."started_at" <= ${lte}`;
}

function durationLateralSql(): Prisma.Sql {
  const pageNames = SESSION_PAGE_EVENT_NAMES.map((name) => Prisma.sql`${name}`);
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS event_count,
        MAX(e."created_at") AS last_event_at,
        COUNT(DISTINCT CASE
          WHEN e."name" IN (${Prisma.join(pageNames)})
            THEN COALESCE(
              NULLIF(TRIM(e."properties"->>'name'), ''),
              NULLIF(TRIM(e."properties"->>'url'), ''),
              NULLIF(TRIM(e."properties"->>'path'), ''),
              e."id"::text
            )
        END)::int AS page_count
      FROM "Event" e
      WHERE e."project_id" = s."project_id"
        AND e."session_id" = s."session_id"
        AND e."app" = s."app"
    ) ev ON TRUE
  `;
}

function durationSecSql(): Prisma.Sql {
  return Prisma.sql`COALESCE(
    CASE
      WHEN s."ended_at" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (s."ended_at" - s."started_at"))
    END,
    CASE
      WHEN ev.last_event_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (ev.last_event_at - s."started_at"))
    END,
    0
  )`;
}

async function fetchBreakdown(
  prisma: PrismaClient,
  column: Prisma.Sql,
  where: Prisma.Sql,
  total: number
): Promise<VisitBreakdownRow[]> {
  const rows = await prisma.$queryRaw<Array<{ label: string; count: number }>>(Prisma.sql`
    SELECT COALESCE(NULLIF(TRIM(${column}), ''), '(not set)') AS label,
           COUNT(*)::int AS count
    FROM "Session" s
    WHERE ${where}
    GROUP BY 1
    ORDER BY count DESC, label ASC
    LIMIT 8
  `);
  return rows.map((row) => ({
    label: row.label,
    count: Number(row.count),
    sharePct: sharePct(Number(row.count), total),
  }));
}

const screenLabelSql = Prisma.sql`COALESCE(
  NULLIF(TRIM(e."properties"->>'name'), ''),
  NULLIF(TRIM(e."properties"->>'path'), ''),
  NULLIF(TRIM(e."properties"->>'url'), ''),
  '(unnamed screen)'
)`;

export async function fetchVisitsSummary(
  prisma: PrismaClient,
  projectId: string,
  filter: SessionListFilterInput,
  window: ResolvedSummaryWindow
): Promise<VisitsSummary> {
  const filters = sessionFilterSql(projectId, filter, {
    gte: window.since,
    lte: window.until,
  });
  const bounds = sessionBoundsSql(window.since, window.until);
  const where = Prisma.sql`${filters} AND ${bounds}`;
  const pageNames = SESSION_PAGE_EVENT_NAMES.map((name) => Prisma.sql`${name}`);
  const eventUntil = new Date(window.until.getTime() + 24 * 60 * 60 * 1000);

  const [scalars, recent] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        visits: number;
        visitors: number;
        avg_duration_sec: number | null;
        median_duration_sec: number | null;
        pages_per_visit: number | null;
        events_per_visit: number | null;
        single_screen: number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS visits,
        COUNT(DISTINCT COALESCE(
          NULLIF(TRIM(s."user_id"), ''),
          NULLIF(TRIM(s."anonymous_id"), '')
        ))::int AS visitors,
        AVG(${durationSecSql()}) AS avg_duration_sec,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${durationSecSql()}) AS median_duration_sec,
        AVG(COALESCE(ev.page_count, 0)) AS pages_per_visit,
        AVG(COALESCE(ev.event_count, 0)) AS events_per_visit,
        COUNT(*) FILTER (WHERE COALESCE(ev.page_count, 0) <= 1)::int AS single_screen
      FROM "Session" s
      ${durationLateralSql()}
      WHERE ${where}
    `),
    listSessionsEnriched(
      prisma,
      filter,
      projectId,
      { gte: window.since, lte: window.until },
      "started_at",
      "desc",
      0,
      8,
      { includeTotals: false }
    ),
  ]);

  const scalar = scalars[0];
  const visits = Number(scalar?.visits ?? 0);
  const uniqueVisitors = Number(scalar?.visitors ?? 0);

  const sessionMatch = Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "Session" s
      WHERE s."project_id" = e."project_id"
        AND s."session_id" = e."session_id"
        AND s."app" = e."app"
        AND ${where}
    )
    AND e."created_at" >= ${window.since}
    AND e."created_at" <= ${eventUntil}
  `;

  const [countries, browsers, operatingSystems, platforms, topScreens, topActions] =
    await Promise.all([
      fetchBreakdown(prisma, Prisma.sql`s."country"`, where, visits),
      fetchBreakdown(prisma, Prisma.sql`s."device_browser"`, where, visits),
      fetchBreakdown(prisma, Prisma.sql`s."device_os"`, where, visits),
      fetchBreakdown(prisma, Prisma.sql`s."platform"`, where, visits),
      prisma.$queryRaw<Array<{ name: string; views: number; visits: number }>>(Prisma.sql`
        SELECT ${screenLabelSql} AS name,
               COUNT(*)::int AS views,
               COUNT(DISTINCT e."session_id")::int AS visits
        FROM "Event" e
        WHERE e."project_id" = ${projectId}
          AND e."name" IN (${Prisma.join(pageNames)})
          AND ${sessionMatch}
        GROUP BY 1
        ORDER BY views DESC, name ASC
        LIMIT 10
      `),
      prisma.$queryRaw<Array<{ name: string; count: number; visits: number }>>(Prisma.sql`
        SELECT e."name" AS name,
               COUNT(*)::int AS count,
               COUNT(DISTINCT e."session_id")::int AS visits
        FROM "Event" e
        WHERE e."project_id" = ${projectId}
          AND e."name" NOT IN (${Prisma.join(pageNames)})
          AND e."name" NOT LIKE '$%'
          AND ${sessionMatch}
        GROUP BY 1
        ORDER BY count DESC, name ASC
        LIMIT 10
      `),
    ]);

  return {
    window: {
      since: window.since.toISOString(),
      until: window.until.toISOString(),
      label: window.label,
    },
    visits,
    uniqueVisitors,
    avgDurationSec: Math.round(Number(scalar?.avg_duration_sec ?? 0)),
    medianDurationSec: Math.round(Number(scalar?.median_duration_sec ?? 0)),
    pagesPerVisit: round1(Number(scalar?.pages_per_visit ?? 0)),
    eventsPerVisit: round1(Number(scalar?.events_per_visit ?? 0)),
    singleScreenPct: sharePct(Number(scalar?.single_screen ?? 0), visits),
    countries,
    browsers,
    operatingSystems,
    platforms,
    topScreens: topScreens.map((row) => ({
      name: row.name,
      views: Number(row.views),
      visits: Number(row.visits),
    })),
    topActions: topActions.map((row) => ({
      name: row.name,
      count: Number(row.count),
      visits: Number(row.visits),
    })),
    recent: recent.rows.map((row) => serializeSessionListItem(row)),
  };
}
