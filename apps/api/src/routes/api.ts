import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  buildErrorOccurrenceScopeWhere,
  fetchImpactMetricsForGroupId,
  fetchMetricsForGroupIds,
  fetchScopedOccurrenceSummaryForGroupId,
  fetchSparklinesForGroupIds,
  isAggregateSort,
  listErrorGroupsAggregated,
  listErrorGroupsPrisma,
  listScopedOccurrenceIdsForGroupId,
  parseErrorListOrderParam,
  parseErrorListSortParam,
  parseTrendWindowParam,
  requiresScopedSeenAggregateSort,
  serializeErrorGroupListItem,
  type ErrorGroupListRow,
  type ErrorListFilterInput,
  type ScalarErrorListSort,
} from "../lib/errors-list-query.js";
import { fetchErrorsAnalytics } from "../lib/errors-analytics.js";
import { fetchEventsAnalytics } from "../lib/events-analytics.js";
import {
  enrichErrorListFilterForMetrics,
  errorFilterForComparedWindow,
  fetchErrorsPageSummary,
  parseErrorsMetricsAnchor,
  resolveErrorsSummaryWindow,
} from "../lib/errors-page-summary.js";
import {
  enrichEventListFilterForMetrics,
  fetchEventsPageSummary,
  parseEventsMetricsAnchor,
  resolveEventsSummaryWindow,
} from "../lib/events-page-summary.js";
import {
  fetchSessionsAnalytics,
  parseChartBucketParam,
} from "../lib/sessions-analytics.js";
import {
  fetchSessionsPageSummary,
  buildSessionListFilter,
  parseSessionsMetricsAnchor,
  resolveSessionListStartedAtBounds,
  resolveSessionsSummaryWindow,
} from "../lib/sessions-page-summary.js";
import {
  buildPerformanceFilter,
  fetchPerformancePageSummary,
  parsePerformanceMetricsAnchor,
  resolvePerformanceSummaryWindow,
} from "../lib/performance-page-summary.js";
import {
  fetchSlowPages,
  fetchSlowRoutes,
} from "../lib/performance-slow-paths.js";
import {
  buildReleasesFilter,
  fetchReleasesPageSummary,
  parseReleasesMetricsAnchor,
  parseReleasesOrderParam,
  parseReleasesSortParam,
  resolveReleasesSummaryWindow,
} from "../lib/releases-page-summary.js";
import {
  attachLatestEventIds,
  fetchSparklinesForEventNames,
  listEventNamesGrouped,
  parseEventListOrderParam,
  parseEventListSortParam,
  serializeEventNameListItem,
  type EventListFilterInput,
} from "../lib/events-list-query.js";
import {
  fetchSessionEnrichedById,
  listSessionsEnriched,
  parseSessionListOrderParam,
  parseSessionListSortParam,
  serializeSessionListItem,
} from "../lib/sessions-list-query.js";
import { parseCreatedRange } from "../lib/list-query.js";
import { buildEventWhereSql } from "../lib/list-query-helpers.js";
import { fetchLatestEventsByName } from "../lib/latest-events-by-name.js";
import { getOverviewTimeSeries } from "../lib/overview-timeseries.js";
import {
  buildWorkspaceTelemetry,
  computeOverviewHealth,
  getOverviewActiveUsersPair,
  getOverviewErrorCountsPair,
  getOverviewEventWindowStats,
  getOverviewSessionsPair,
  getSessionDurationSeries,
  listActiveIssues,
  listDistinctEnvironments,
} from "../lib/overview-stats.js";
import {
  isRollingCompareMode,
  parseCompareMode,
  resolveCompareWindows,
} from "../lib/compare-windows.js";
import { applySummaryCompare } from "../lib/summary-compare-window.js";
import {
  buildOverviewSessionFilter,
  countOverviewErrorGroupsInWindow,
  fetchOverviewRequestMetrics,
  listOverviewErrorGroupsInWindow,
  listOverviewRecentSessions,
  listOverviewTopErrorGroups,
  sparklinesFromTimeSeries,
} from "../lib/overview-kpi.js";
import { getAppNavSummariesForProject } from "../lib/app-nav-summary.js";
import {
  distinctAppsForProject,
  distinctEnvironmentsForProject,
} from "../lib/project-scope-labels.js";
import {
  whereErrorGroupById,
  whereErrorGroupProject,
  whereEventById,
  whereEventProject,
  whereSessionById,
  whereSessionProject,
} from "../lib/prisma-project-scope.js";
import { requireSessionUser } from "../lib/auth-session.js";
import { canResolveErrors, getMembershipRoleForProject } from "../lib/org-permissions.js";
import { readOrganizationIdHeader } from "../lib/http-headers.js";
import { effectiveOverviewWindow, isUnselectedTimeRange, parseOverviewTimeRangeQuery, chooseTimeRangeBucket } from "../lib/time-range.js";
import { resolveUnselectedMetricsWindow } from "../lib/overview-metrics-window.js";
import {
  resolveReadProjectId,
  resolveReadProjectIdWithSession,
} from "../lib/read-project-request.js";
import { loadIssueExportDocument } from "../lib/issue-export-load.js";
import { releasePrismaWhere } from "../lib/release-key.js";
import {
  EVENT_SORT_SQL,
  overviewErrorOrderBy,
  parseEventListSortParam as parseRawEventListSortParam,
  parseListOrderParam,
  parseOverviewErrorSortParam,
  parseOverviewTopEventsSortParam,
} from "../lib/list-sort-params.js";
import {
  mergeGlobalSearchScope,
  parseGlobalSearchQuery,
} from "../lib/global-search-query.js";
import { executeGlobalSearch } from "../lib/global-search.js";

const DEFAULT_LIST_PAGE_SIZE = 20;
const MAX_LIST_PAGE_SIZE = 100;
const OVERVIEW_LIST_PAGE_SIZE = 10;
const MAX_OVERVIEW_LIST_PAGE_SIZE = 50;

function parsePositivePage(value: string | undefined, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parseListPageSize(
  pageSize: string | undefined,
  limit: string | undefined,
  fallback = DEFAULT_LIST_PAGE_SIZE
): number {
  const raw = pageSize ?? limit;
  const n = Math.floor(Number(raw));
  const v = Number.isFinite(n) && n >= 1 ? n : fallback;
  return Math.min(MAX_LIST_PAGE_SIZE, Math.max(1, v));
}

/** Fastify can expose repeated query keys as `string[]`; normalize to a single trimmed app id. */
function queryApp(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const t = typeof raw === "string" ? raw.trim() : "";
  return t || undefined;
}

function queryString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const t = typeof raw === "string" ? raw.trim() : "";
  return t || undefined;
}

export async function apiRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  app.get("/overview", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      range?: string;
      from?: string;
      to?: string;
      app?: string | string[];
      environment?: string;
      platform?: string;
      release?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
      metricsUntil?: string;
      errorsPage?: string;
      eventsPage?: string;
      listPageSize?: string;
      errorsSort?: string;
      errorsOrder?: string;
      topEventsSort?: string;
      topEventsOrder?: string;
    };
    const timeRangeParsed = parseOverviewTimeRangeQuery(
      {
        range: queryString(query.range),
        from: queryString(query.from),
        to: queryString(query.to),
      },
      new Date()
    );
    if (!timeRangeParsed.ok) {
      return reply.status(400).send({ error: timeRangeParsed.error });
    }
    const timeRange = timeRangeParsed.range;
    const since = timeRange.gte;
    const until = timeRange.lte;
    const appFilter = queryApp(query.app);
    const environment = queryString(query.environment);
    const platform = queryString(query.platform);
    const release = queryString(query.release);
    const metricsUntilRaw = queryString(query.metricsUntil);
    const metricsAnchor = metricsUntilRaw
      ? parseErrorsMetricsAnchor(metricsUntilRaw)
      : until;
    const metricsWindow = isUnselectedTimeRange(timeRange.key)
      ? await resolveUnselectedMetricsWindow(prisma, {
          projectId,
          until: metricsAnchor,
          app: appFilter,
          environment,
          platform,
          release,
        })
      : effectiveOverviewWindow(timeRange);
    const compareMode = parseCompareMode(queryString(query.compare));
    const errSortParsed = parseOverviewErrorSortParam(queryString(query.errorsSort));
    if (!errSortParsed.ok) {
      return reply.status(400).send({ error: "Invalid errorsSort" });
    }
    const errOrderParsed = parseListOrderParam(queryString(query.errorsOrder));
    if (!errOrderParsed.ok) {
      return reply.status(400).send({ error: "Invalid errorsOrder" });
    }
    const topEvSortParsed = parseOverviewTopEventsSortParam(queryString(query.topEventsSort));
    if (!topEvSortParsed.ok) {
      return reply.status(400).send({ error: "Invalid topEventsSort" });
    }
    const topEvOrderParsed = parseListOrderParam(queryString(query.topEventsOrder));
    if (!topEvOrderParsed.ok) {
      return reply.status(400).send({ error: "Invalid topEventsOrder" });
    }
    const compareResolved = resolveCompareWindows({
      mode: compareMode,
      since: metricsWindow.gte,
      until: metricsWindow.lte,
      label: timeRange.label,
      anchor: metricsWindow.lte,
      custom: {
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      },
    });
    if (!compareResolved.ok) {
      return reply.status(400).send({ error: compareResolved.error });
    }
    const effectiveMetrics = isRollingCompareMode(compareMode)
      ? {
          gte: metricsWindow.gte,
          lte: metricsWindow.lte,
          durationMs: metricsWindow.durationMs,
          label: timeRange.label,
        }
      : {
          gte: compareResolved.windows.since,
          lte: compareResolved.windows.until,
          durationMs: Math.max(
            compareResolved.windows.until.getTime() -
              compareResolved.windows.since.getTime(),
            1
          ),
          label: compareResolved.windows.label,
        };
    const metricsBucket = chooseTimeRangeBucket(effectiveMetrics.durationMs);
    // Calendar/custom compare modes align charts with the effective metrics window.
    const chartSince = isRollingCompareMode(compareMode)
      ? isUnselectedTimeRange(timeRange.key)
        ? metricsWindow.gte
        : since
      : effectiveMetrics.gte;
    const chartUntil = isRollingCompareMode(compareMode)
      ? isUnselectedTimeRange(timeRange.key)
        ? metricsWindow.lte
        : until
      : effectiveMetrics.lte;
    const chartBucket = isRollingCompareMode(compareMode)
      ? isUnselectedTimeRange(timeRange.key)
        ? metricsBucket.bucket
        : timeRange.bucket
      : metricsBucket.bucket;
    const chartBucketSeconds = isRollingCompareMode(compareMode)
      ? isUnselectedTimeRange(timeRange.key)
        ? metricsBucket.bucketSeconds
        : timeRange.bucketSeconds
      : metricsBucket.bucketSeconds;
    /** Rolling modes keep the historic `compare` response field; calendar/custom use mode name. */
    const compare = compareMode;
    const compareWindow = {
      previousSince: compareResolved.windows.previousSince,
      previousUntil: compareResolved.windows.previousUntil,
    };
    const metricsScope = {
      projectId,
      since: effectiveMetrics.gte,
      until: effectiveMetrics.lte,
      app: appFilter,
      environment,
      platform,
      release,
    };
    const listScope = {
      projectId,
      since,
      until,
      app: appFilter,
      environment,
      platform,
      release,
    };
    const listPageSize = Math.min(
      MAX_OVERVIEW_LIST_PAGE_SIZE,
      Math.max(
        1,
        Math.floor(Number(query.listPageSize)) || OVERVIEW_LIST_PAGE_SIZE
      )
    );
    const errorsPage = parsePositivePage(query.errorsPage, 1);
    const eventsPage = parsePositivePage(query.eventsPage, 1);
    const errorsSkip = (errorsPage - 1) * listPageSize;
    const eventsSkip = (eventsPage - 1) * listPageSize;

    const errorGroupOrderBy = overviewErrorOrderBy(
      errSortParsed.sort,
      errOrderParsed.order
    );
    const eventGroupByOrderBy =
      topEvSortParsed.sort === "count"
        ? { _count: { name: topEvOrderParsed.order } }
        : { name: topEvOrderParsed.order };

    const useScopedErrorList = Boolean(platform || release);
    // Platform/release lists must use metricsScope so counts match KPIs/charts when
    // the overview time range is unselected (epoch→now vs ~30d metrics window)
    // or when a calendar compare mode overrides the metrics window.
    const scopedErrorListScope = useScopedErrorList ? metricsScope : listScope;
    const eventListSince = useScopedErrorList ? effectiveMetrics.gte : since;
    const eventListUntil = useScopedErrorList ? effectiveMetrics.lte : until;

    const baseWhere = {
      ...whereEventProject(projectId),
      created_at: { gte: eventListSince, lte: eventListUntil },
    };
    const eventWhere = {
      ...baseWhere,
      ...(appFilter ? { app: appFilter } : {}),
      ...(environment ? { environment } : {}),
      ...(platform ? { platform } : {}),
      ...releasePrismaWhere(release),
    };
    const errorGroupWhere = {
      ...whereErrorGroupProject(projectId),
      last_seen: { gte: since, lte: until },
      ...(appFilter ? { app: appFilter } : {}),
      ...(environment ? { environment } : {}),
      ...((platform || release)
        ? {
            occurrences_list: {
              some: {
                created_at: { gte: since, lte: until },
                ...(platform ? { platform } : {}),
                ...(release ? { release } : {}),
              },
            },
          }
        : {}),
    };

    const previousUntil = compareWindow.previousUntil ?? effectiveMetrics.gte;
    const windowParams = {
      projectId,
      since: effectiveMetrics.gte,
      until: effectiveMetrics.lte,
      previousSince: compareWindow.previousSince,
      previousUntil,
      app: appFilter,
      environment,
      platform,
      release,
    };

    const eventListWhereSql = buildEventWhereSql({
      projectId,
      appId: appFilter,
      environment,
      platform,
      release,
      gte: eventListSince,
      lte: eventListUntil,
    });

    const activeIssueLinkScope = {
      app: appFilter,
      environment,
      platform,
      release,
      ...(timeRange.key === "absolute"
        ? {
            from: queryString(query.from),
            to: queryString(query.to),
          }
        : { range: timeRange.key }),
      // Forward exact metrics window when the issue list itself uses that window
      // (open-ended Overview, or platform/release lists that follow metricsScope /
      // calendar compare). Bounded list-range rows keep the page range.
      ...(isUnselectedTimeRange(timeRange.key) ||
      ((platform || release) && !isRollingCompareMode(compareMode))
        ? {
            metricsSince: effectiveMetrics.gte.toISOString(),
            metricsUntil: effectiveMetrics.lte.toISOString(),
          }
        : {}),
    };

    const [
      errorCounts,
      eventStats,
      errorsListTotal,
      eventsListTotal,
      errorGroups,
      eventCounts,
      series,
      sessionCounts,
      activeUserCounts,
      environments,
      sessionDurationSeries,
      activeIssues,
      requestMetrics,
      recentSessions,
      metricsTopErrorGroups,
    ] = await Promise.all([
      getOverviewErrorCountsPair(prisma, windowParams),
      getOverviewEventWindowStats(prisma, windowParams),
      useScopedErrorList
        ? countOverviewErrorGroupsInWindow(prisma, scopedErrorListScope)
        : prisma.errorGroup.count({ where: errorGroupWhere }),
      prisma.$queryRaw<[{ c: bigint }]>(Prisma.sql`
        SELECT COUNT(DISTINCT e."name")::bigint AS c
        FROM "Event" e
        WHERE ${eventListWhereSql}
      `),
      useScopedErrorList
        ? listOverviewErrorGroupsInWindow(prisma, scopedErrorListScope, {
            sort: errSortParsed.sort,
            order: errOrderParsed.order,
            skip: errorsSkip,
            take: listPageSize,
          })
        : prisma.errorGroup.findMany({
            where: errorGroupWhere,
            skip: errorsSkip,
            take: listPageSize,
            orderBy: errorGroupOrderBy,
            include: { _count: { select: { occurrences_list: true } } },
          }),
      // Release filters need TRIM / Unknown SQL matching (Prisma equality diverges).
      release
        ? prisma
            .$queryRaw<{ name: string; c: bigint }[]>(Prisma.sql`
              SELECT e."name" AS name, COUNT(*)::bigint AS c
              FROM "Event" e
              WHERE ${eventListWhereSql}
              GROUP BY e."name"
              ORDER BY ${
                topEvSortParsed.sort === "count"
                  ? topEvOrderParsed.order === "asc"
                    ? Prisma.sql`COUNT(*) ASC, e."name" ASC`
                    : Prisma.sql`COUNT(*) DESC, e."name" ASC`
                  : topEvOrderParsed.order === "asc"
                    ? Prisma.sql`e."name" ASC`
                    : Prisma.sql`e."name" DESC`
              }
              OFFSET ${eventsSkip}
              LIMIT ${listPageSize}
            `)
            .then((rows) =>
              rows.map((row) => ({
                name: row.name,
                _count: { name: Number(row.c) },
              }))
            )
        : prisma.event.groupBy({
            by: ["name"],
            where: eventWhere,
            _count: { name: true },
            orderBy: eventGroupByOrderBy,
            skip: eventsSkip,
            take: listPageSize,
          }),
      getOverviewTimeSeries(
        prisma,
        projectId,
        chartSince,
        chartUntil,
        chartBucket,
        appFilter,
        environment,
        platform,
        release
      ),
      getOverviewSessionsPair(
        prisma,
        metricsScope,
        compareWindow.previousSince,
        previousUntil
      ),
      getOverviewActiveUsersPair(prisma, windowParams),
      listDistinctEnvironments(prisma, projectId, appFilter),
      getSessionDurationSeries(
        prisma,
        projectId,
        chartBucket,
        chartSince,
        chartUntil,
        appFilter,
        environment,
        platform,
        release
      ),
      listActiveIssues(
        prisma,
        platform || release ? metricsScope : listScope,
        5,
        activeIssueLinkScope
      ),
      fetchOverviewRequestMetrics(
        prisma,
        metricsScope,
        compareWindow.previousSince,
        previousUntil,
        chartBucket
      ),
      listOverviewRecentSessions(
        prisma,
        buildOverviewSessionFilter(metricsScope, {
          gte: effectiveMetrics.gte,
          lte: effectiveMetrics.lte,
        }),
        projectId,
        { gte: effectiveMetrics.gte, lte: effectiveMetrics.lte },
        8
      ),
      listOverviewTopErrorGroups(prisma, metricsScope, 8),
    ]);

    const errorsCount = errorCounts.current;
    const errorsPrevious = errorCounts.previous;
    const eventsCount = eventStats.eventsCount;
    const eventsPrevious = eventStats.eventsPrevious;
    const eventsListTotalCount = Number(eventsListTotal[0]?.c ?? 0);
    const workspaceTelemetry = buildWorkspaceTelemetry(
      eventsCount,
      errorsCount,
      eventStats.distinctApps,
      eventStats.distinctSdkVersions
    );
    const sessionsCount = sessionCounts.current;
    const sessionsPrevious = sessionCounts.previous;
    const activeUsers = activeUserCounts.current;
    const activeUsersPrevious = activeUserCounts.previous;

    const health = computeOverviewHealth(
      eventsCount,
      errorsCount,
      eventsPrevious,
      errorsPrevious,
      series.events,
      chartBucketSeconds
    );

    const latestByName = await fetchLatestEventsByName(prisma, {
      projectId,
      since: eventListSince,
      until: eventListUntil,
      app: appFilter,
      environment,
      platform,
      release,
      names: eventCounts.map((row) => row.name),
    });

    const topEvents = eventCounts.map((row: { name: string; _count: { name: number } }) => {
      const latest = latestByName.get(row.name);
      return {
        name: row.name,
        count: row._count.name,
        app: latest?.app ?? "",
        platform: latest?.platform ?? null,
        environment: latest?.environment ?? null,
        release: latest?.release ?? null,
        lastSeen: latest?.created_at.toISOString() ?? null,
      };
    });

    return reply.send({
      range: timeRange.key,
      rangeLabel: effectiveMetrics.label,
      since: since.toISOString(),
      until: until.toISOString(),
      metricsSince: effectiveMetrics.gte.toISOString(),
      metricsUntil: effectiveMetrics.lte.toISOString(),
      metricsDurationMs: effectiveMetrics.durationMs,
      bucket: chartBucket,
      compare,
      compareLabel: compareResolved.windows.compareLabel,
      errorsLast24h: errorsCount,
      eventsLast24h: eventsCount,
      errorsPrevious,
      eventsPrevious,
      sessionsCount,
      sessionsPrevious,
      activeUsers,
      activeUsersPrevious,
      environments,
      health,
      activeIssues,
      workspaceTelemetry,
      topErrorGroups: errorGroups,
      topEvents,
      errorsListTotal,
      eventsListTotal: eventsListTotalCount,
      errorsPage,
      eventsPage,
      listPageSize,
      series,
      sessionDurationSeries,
      kpiSparklines: sparklinesFromTimeSeries(series),
      requestMetrics,
      recentSessions,
      metricsTopErrorGroups,
    });
  });

  app.get("/errors/summary", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      environment?: string;
      release?: string;
      platform?: string;
      q?: string;
      status?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const platform = queryString(query.platform);
    const q = queryString(query.q);
    const status = queryString(query.status) ?? "all";
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseErrorsMetricsAnchor(queryString(query.metricsUntil));

    const filter: ErrorListFilterInput = {
      appId,
      environment,
      release,
      platform,
      q,
      range,
      status:
        status === "unresolved"
          ? "unresolved"
          : status === "resolved"
            ? "resolved"
            : "all",
    };

    const baseWindow = resolveErrorsSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const summary = await fetchErrorsPageSummary(
      prisma,
      errorFilterForComparedWindow(filter, compared.window),
      projectId,
      compared.window
    );
    return reply.send(summary);
  });

  app.get("/errors/analytics", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      environment?: string;
      release?: string;
      platform?: string;
      q?: string;
      status?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const platform = queryString(query.platform);
    const q = queryString(query.q);
    const status = queryString(query.status) ?? "all";
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseErrorsMetricsAnchor(queryString(query.metricsUntil));

    const filter: ErrorListFilterInput = {
      appId,
      environment,
      release,
      platform,
      q,
      range,
      status:
        status === "unresolved"
          ? "unresolved"
          : status === "resolved"
            ? "resolved"
            : "all",
    };

    const baseWindow = resolveErrorsSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const analytics = await fetchErrorsAnalytics(
      prisma,
      errorFilterForComparedWindow(filter, compared.window, {
        includePrevious: false,
      }),
      projectId,
      compared.window
    );
    return reply.send(analytics);
  });

  app.get("/errors", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      page?: string;
      pageSize?: string;
      limit?: string;
      range?: string;
      from?: string;
      to?: string;
      environment?: string;
      release?: string;
      platform?: string;
      q?: string;
      status?: string;
      sort?: string;
      order?: string;
      trendWindow?: string;
      trendFrom?: string;
      trendTo?: string;
      metricsUntil?: string;
    };
    const pageSize = parseListPageSize(query.pageSize, query.limit);
    const page = parsePositivePage(query.page, 1);
    const skip = (page - 1) * pageSize;
    const appId = queryApp(query.app);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const platform = queryString(query.platform);
    const q = queryString(query.q);
    const status = queryString(query.status) ?? "all";
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseErrorsMetricsAnchor(queryString(query.metricsUntil));

    const sortParsed = parseErrorListSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.status(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseErrorListOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.status(400).send({ error: "Invalid order" });
    }
    const trendEnd = range.lte ?? new Date();
    const trendWindowParsed = parseTrendWindowParam(
      {
        trendWindow: queryString(query.trendWindow),
        trendFrom: queryString(query.trendFrom),
        trendTo: queryString(query.trendTo),
      },
      trendEnd
    );
    if (!trendWindowParsed.ok) {
      return reply.status(400).send({ error: trendWindowParsed.error });
    }
    const trend = trendWindowParsed.trend;

    const filter: ErrorListFilterInput = {
      appId,
      environment,
      release,
      platform,
      q,
      range,
      status:
        status === "unresolved"
          ? "unresolved"
          : status === "resolved"
            ? "resolved"
            : "all",
    };
    const metricsFilter = enrichErrorListFilterForMetrics(filter, range, metricsAnchor);

    // Platform/release always use the aggregate path so membership, counts, and
    // first/last seen stay inside the list/metrics window (no lifetime fallbacks).
    if (
      isAggregateSort(sortParsed.sort) ||
      requiresScopedSeenAggregateSort(sortParsed.sort, metricsFilter) ||
      Boolean(metricsFilter.platform || metricsFilter.release)
    ) {
      const { total, rows } = await listErrorGroupsAggregated(
        prisma,
        metricsFilter,
        projectId,
        sortParsed.sort,
        orderParsed.order,
        trend.durationMs,
        trend.end,
        skip,
        pageSize
      );
      const sparklines = await fetchSparklinesForGroupIds(
        prisma,
        rows.map((r) => r.id),
        trend.durationMs,
        trend.end,
        metricsFilter.release,
        metricsFilter.platform
      );
      const items = rows.map((r) =>
        serializeErrorGroupListItem({
          ...r,
          sparkline: sparklines.get(r.id) ?? [],
        })
      );
      return reply.send({ items, total, page, pageSize });
    }

    const scalarSort = sortParsed.sort as ScalarErrorListSort;
    const { total, groups } = await listErrorGroupsPrisma(
      prisma,
      filter,
      projectId,
      scalarSort,
      orderParsed.order,
      skip,
      pageSize
    );
    const metrics = await fetchMetricsForGroupIds(
      prisma,
      groups.map((g) => g.id),
      trend.durationMs,
      trend.end,
      {
        range: metricsFilter.range,
        release: metricsFilter.release,
        platform: metricsFilter.platform,
        occurrenceCountRange: metricsFilter.occurrenceCountRange,
      }
    );
    const sparklines = await fetchSparklinesForGroupIds(
      prisma,
      groups.map((g) => g.id),
      trend.durationMs,
      trend.end,
      metricsFilter.release,
      metricsFilter.platform
    );
    const items = groups.map((g) => {
      const m = metrics.get(g.id);
      const row: ErrorGroupListRow = {
        id: g.id,
        fingerprint: g.fingerprint,
        message: g.message,
        top_stack: g.top_stack,
        app: g.app,
        environment: g.environment,
        release: g.release,
        platform: g.platform,
        occurrences: g.occurrences,
        first_seen: m?.first_seen ?? g.first_seen,
        last_seen: m?.last_seen ?? g.last_seen,
        resolved_at: g.resolved_at,
        users_affected: m?.users_affected ?? 0,
        sessions_affected: m?.sessions_affected ?? 0,
        occurrences_recent: m?.occurrences_recent ?? 0,
        occurrences_previous: m?.occurrences_previous ?? 0,
        trend_ratio: m?.trend_ratio ?? 0,
        occurrences_in_range: m?.occurrences_in_range ?? 0,
        sparkline: sparklines.get(g.id) ?? [],
      };
      return serializeErrorGroupListItem(row);
    });
    return reply.send({ items, total, page, pageSize });
  });

  app.patch<{ Params: { id: string } }>("/errors/:id", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const role = await getMembershipRoleForProject(session.userId, projectId);
    if (!canResolveErrors(role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as { resolved?: boolean };
    if (typeof body?.resolved !== "boolean") {
      return reply.status(400).send({ error: "Body must be JSON with resolved: boolean" });
    }
    try {
      const existing = await prisma.errorGroup.findFirst({
        where: whereErrorGroupById(request.params.id, projectId),
      });
      if (!existing) return reply.status(404).send({ error: "Not found" });
      const group = await prisma.errorGroup.update({
        where: { id: existing.id },
        data: { resolved_at: body.resolved ? new Date() : null },
      });
      return reply.send(group);
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.get<{ Params: { id: string } }>("/errors/:id", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { id } = request.params;
    const query = request.query as {
      app?: string;
      environment?: string;
      platform?: string;
      release?: string;
      range?: string;
      from?: string;
      to?: string;
      metricsUntil?: string;
      metricsSince?: string;
    };
    const appFilter = queryApp(query.app);
    const environment = queryString(query.environment);
    const platform = queryString(query.platform);
    const release = queryString(query.release);
    const rangeKey = queryString(query.range);
    const metricsUntilRaw = queryString(query.metricsUntil);
    const metricsSinceRaw = queryString(query.metricsSince);
    const hasFromTo = Boolean(queryString(query.from) || queryString(query.to));
    // Issues list passes metricsUntil only (~7d). Overview open-ended drills pass
    // metricsSince+metricsUntil for the exact resolveUnselectedMetricsWindow.
    // Legacy Overview range=none/all without metricsUntil still uses that helper.
    const parseIsoDate = (raw: string | undefined): Date | undefined => {
      if (!raw) return undefined;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    };
    const explicitMetricsSince = parseIsoDate(metricsSinceRaw);
    const explicitMetricsUntil = parseIsoDate(metricsUntilRaw);
    const explicitOverviewWindow =
      explicitMetricsSince &&
      explicitMetricsUntil &&
      explicitMetricsSince.getTime() < explicitMetricsUntil.getTime()
        ? { gte: explicitMetricsSince, lte: explicitMetricsUntil }
        : undefined;
    const useIssuesMetricsWindow =
      Boolean(metricsUntilRaw) && !explicitOverviewWindow;
    const isOverviewUnselected =
      !hasFromTo &&
      (rangeKey === "none" || rangeKey === "all") &&
      !useIssuesMetricsWindow &&
      !explicitOverviewWindow;
    const hasBoundedPreset =
      hasFromTo || Boolean(rangeKey && rangeKey !== "all" && rangeKey !== "none");
    const listRange = parseCreatedRange(query, "all");
    const metricsAnchor = parseErrorsMetricsAnchor(metricsUntilRaw);

    let windowGte: Date | undefined;
    let windowLte: Date | undefined;
    if (explicitOverviewWindow) {
      windowGte = explicitOverviewWindow.gte;
      windowLte = explicitOverviewWindow.lte;
    } else if (isOverviewUnselected) {
      const metricsWindow = await resolveUnselectedMetricsWindow(prisma, {
        projectId,
        until: metricsAnchor,
        app: appFilter,
        environment,
        platform,
        release,
      });
      windowGte = metricsWindow.gte;
      windowLte = metricsWindow.lte;
    } else if (hasBoundedPreset) {
      windowGte = listRange.gte;
      windowLte = listRange.lte;
    } else if (platform || release || useIssuesMetricsWindow) {
      const enriched = enrichErrorListFilterForMetrics(
        {
          range: listRange,
          status: "all",
          ...(platform ? { platform } : {}),
          ...(release ? { release } : {}),
        },
        listRange,
        metricsAnchor
      );
      windowGte = enriched.range.gte ?? enriched.occurrenceCountRange?.gte;
      windowLte = enriched.range.lte ?? enriched.occurrenceCountRange?.lte;
    }
    const occurrenceScope = {
      ...(platform ? { platform } : {}),
      ...(release ? { release } : {}),
      ...(windowGte ? { gte: windowGte } : {}),
      ...(windowLte ? { lte: windowLte } : {}),
    };
    const applyScopedMetrics = Boolean(
      platform || release || windowGte || windowLte
    );
    // Release filters need SQL TRIM / Unknown matching (same as scoped KPIs).
    // Resolve matching ids first, then load rows via Prisma include.
    const occurrenceScopeFilter = {
      ...(platform ? { platform } : {}),
      ...(release ? { release } : {}),
      ...(windowGte ? { gte: windowGte } : {}),
      ...(windowLte ? { lte: windowLte } : {}),
    };
    const occurrenceWhere = release
      ? {
          id: {
            in: await listScopedOccurrenceIdsForGroupId(
              prisma,
              id,
              projectId,
              occurrenceScopeFilter,
              50
            ),
          },
        }
      : buildErrorOccurrenceScopeWhere(occurrenceScopeFilter);

    const group = await prisma.errorGroup.findFirst({
      where: whereErrorGroupById(id, projectId),
      include: {
        occurrences_list: {
          where:
            Object.keys(occurrenceWhere).length > 0 ? occurrenceWhere : undefined,
          orderBy: { created_at: "desc" },
          take: 50,
        },
      },
    });
    if (!group) return reply.status(404).send({ error: "Not found" });
    const { enrichErrorGroupWithSymbolicatedStacks } = await import("../lib/stack-symbolicate.js");
    const trendEnd = windowLte ?? new Date();
    const trendDurationMs =
      windowGte != null
        ? Math.max(trendEnd.getTime() - windowGte.getTime(), 60_000)
        : 24 * 60 * 60 * 1000;
    const [enriched, impact, sparklineMap, scopedSummary] = await Promise.all([
      enrichErrorGroupWithSymbolicatedStacks(prisma, projectId, group),
      fetchImpactMetricsForGroupId(prisma, id, occurrenceScope),
      fetchSparklinesForGroupIds(
        prisma,
        [id],
        trendDurationMs,
        trendEnd,
        release,
        platform
      ),
      applyScopedMetrics
        ? fetchScopedOccurrenceSummaryForGroupId(prisma, id, occurrenceScope)
        : Promise.resolve(null),
    ]);

    const sessionClientIds = [
      ...new Set(
        enriched.occurrences_list
          .map((o) => o.session_id)
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      ),
    ];
    const sessionRows =
      sessionClientIds.length > 0
        ? await prisma.session.findMany({
            where: {
              project_id: projectId,
              app: group.app,
              session_id: { in: sessionClientIds },
            },
            select: { id: true, session_id: true },
          })
        : [];
    const sessionRowByClientId = new Map(sessionRows.map((s) => [s.session_id, s.id]));
    const occurrences_list = enriched.occurrences_list.map((o) => ({
      ...o,
      session_row_id: o.session_id ? sessionRowByClientId.get(o.session_id) ?? null : null,
    }));

    return reply.send({
      ...enriched,
      ...impact,
      ...(scopedSummary
        ? {
            occurrences: scopedSummary.occurrences,
            // Never fall back to fingerprint lifetime when a scope/window is active.
            first_seen: scopedSummary.first_seen,
            last_seen: scopedSummary.last_seen,
          }
        : {}),
      occurrences_list,
      sparkline: sparklineMap.get(id) ?? [],
    });
  });

  app.get<{ Params: { id: string } }>("/errors/:id/export", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { id } = request.params;
    const query = request.query as {
      app?: string;
      environment?: string;
      platform?: string;
      release?: string;
      range?: string;
      from?: string;
      to?: string;
      metricsUntil?: string;
      metricsSince?: string;
    };
    const doc = await loadIssueExportDocument(prisma, projectId, id, {
      app: queryApp(query.app),
      environment: queryString(query.environment),
      platform: queryString(query.platform),
      release: queryString(query.release),
      range: queryString(query.range),
      from: queryString(query.from),
      to: queryString(query.to),
      metricsUntil: queryString(query.metricsUntil),
      metricsSince: queryString(query.metricsSince),
    });
    if (!doc) return reply.status(404).send({ error: "Not found" });
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename="issue-${id}.json"`
      )
      .send(doc);
  });

  app.get("/events/summary", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      name?: string;
      environment?: string;
      platform?: string;
      release?: string;
      propertiesContains?: string;
      q?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const name = queryString(query.name);
    const environment = queryString(query.environment);
    const platform = queryString(query.platform);
    const release = queryString(query.release);
    const propertiesContains = queryString(query.propertiesContains);
    const q = queryString(query.q);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseEventsMetricsAnchor(queryString(query.metricsUntil));

    const filter: EventListFilterInput = {
      appId,
      name,
      environment,
      platform,
      release,
      propertiesContains,
      q,
      range,
    };

    const baseWindow = resolveEventsSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const summary = await fetchEventsPageSummary(
      prisma,
      filter,
      projectId,
      compared.window
    );
    return reply.send(summary);
  });

  app.get("/events/analytics", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      name?: string;
      environment?: string;
      platform?: string;
      release?: string;
      propertiesContains?: string;
      q?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const name = queryString(query.name);
    const environment = queryString(query.environment);
    const platform = queryString(query.platform);
    const release = queryString(query.release);
    const propertiesContains = queryString(query.propertiesContains);
    const q = queryString(query.q);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseEventsMetricsAnchor(queryString(query.metricsUntil));

    const filter: EventListFilterInput = {
      appId,
      name,
      environment,
      platform,
      release,
      propertiesContains,
      q,
      range,
    };

    const baseWindow = resolveEventsSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const analytics = await fetchEventsAnalytics(
      prisma,
      filter,
      projectId,
      compared.window
    );
    return reply.send(analytics);
  });

  app.get("/events", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      page?: string;
      pageSize?: string;
      limit?: string;
      name?: string;
      range?: string;
      from?: string;
      to?: string;
      environment?: string;
      platform?: string;
      release?: string;
      propertiesContains?: string;
      q?: string;
      sort?: string;
      order?: string;
      view?: string;
      metricsUntil?: string;
    };
    const pageSize = parseListPageSize(query.pageSize, query.limit);
    const page = parsePositivePage(query.page, 1);
    const skip = (page - 1) * pageSize;
    const appId = queryApp(query.app);
    const name = queryString(query.name);
    const environment = queryString(query.environment);
    const platform = queryString(query.platform);
    const release = queryString(query.release);
    const propertiesContains = queryString(query.propertiesContains);
    const q = queryString(query.q);
    const range = parseCreatedRange(query, "all");
    const view = queryString(query.view) ?? "grouped";
    const metricsAnchor = parseEventsMetricsAnchor(queryString(query.metricsUntil));

    if (view === "grouped") {
      const sortParsed = parseEventListSortParam(queryString(query.sort));
      if (!sortParsed.ok) {
        return reply.status(400).send({ error: "Invalid sort" });
      }
      const orderParsed = parseEventListOrderParam(queryString(query.order));
      if (!orderParsed.ok) {
        return reply.status(400).send({ error: "Invalid order" });
      }

      const filter: EventListFilterInput = {
        appId,
        name,
        environment,
        platform,
        release,
        propertiesContains,
        q,
        range,
      };
      const metricsFilter = enrichEventListFilterForMetrics(filter, range, metricsAnchor);

      const { total, rows } = await listEventNamesGrouped(
        prisma,
        metricsFilter,
        projectId,
        sortParsed.sort,
        orderParsed.order,
        skip,
        pageSize
      );
      const [withIds, sparklines] = await Promise.all([
        attachLatestEventIds(prisma, rows, metricsFilter, projectId),
        fetchSparklinesForEventNames(
          prisma,
          rows.map((r) => r.name),
          metricsFilter,
          projectId
        ),
      ]);
      const items = withIds.map((r) =>
        serializeEventNameListItem({
          ...r,
          sparkline: sparklines.get(r.name) ?? [],
        })
      );
      return reply.send({ items, total, page, pageSize, view: "grouped" });
    }

    const sortParsed = parseRawEventListSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.status(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseListOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.status(400).send({ error: "Invalid order" });
    }
    // Always SQL so release=__unknown__ / TRIM match summary KPIs and Release Health.
    const orderDirSql =
      orderParsed.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const whereSql = buildEventWhereSql({
      projectId,
      appId,
      name,
      environment,
      platform,
      release,
      gte: range.gte,
      lte: range.lte,
      propertiesContains: propertiesContains?.trim() || undefined,
      q: q?.trim() || undefined,
    });
    const ob = EVENT_SORT_SQL[sortParsed.sort];
    const [countRow, rows] = await Promise.all([
      prisma.$queryRaw<[{ c: bigint }]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS c FROM "Event" WHERE ${whereSql}`
      ),
      prisma.$queryRaw<Record<string, unknown>[]>(
        Prisma.sql`SELECT * FROM "Event" WHERE ${whereSql} ORDER BY ${ob} ${orderDirSql} LIMIT ${pageSize} OFFSET ${skip}`
      ),
    ]);
    const total = Number(countRow[0]?.c ?? 0);
    return reply.send({ items: rows, total, page, pageSize, view: "raw" });
  });

  app.get<{ Params: { id: string } }>("/events/:id", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { id } = request.params;
    const event = await prisma.event.findFirst({
      where: whereEventById(id, projectId),
    });
    if (!event) return reply.status(404).send({ error: "Not found" });
    return reply.send(event);
  });

  app.get("/performance/summary", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      metricsUntil?: string;
      chartBucket?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parsePerformanceMetricsAnchor(queryString(query.metricsUntil));
    const chartBucket = parseChartBucketParam(queryString(query.chartBucket));

    const filter = buildPerformanceFilter({
      appId,
      platform,
      environment,
      release,
      range,
    });
    const baseWindow = resolvePerformanceSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const summary = await fetchPerformancePageSummary(
      prisma,
      filter,
      projectId,
      compared.window,
      chartBucket
    );
    return reply.send(summary);
  });

  app.get("/performance/slow-routes", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
      page?: string;
      pageSize?: string;
      limit?: string;
    };
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parsePerformanceMetricsAnchor(queryString(query.metricsUntil));
    const page = parsePositivePage(queryString(query.page), 1);
    const pageSize = parseListPageSize(queryString(query.pageSize), queryString(query.limit));

    const filter = buildPerformanceFilter({
      appId,
      platform,
      environment,
      release,
      range,
    });
    const baseWindow = resolvePerformanceSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(baseWindow, {
      compare: queryString(query.compare),
      compareFrom: queryString(query.compareFrom),
      compareTo: queryString(query.compareTo),
    });
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const result = await fetchSlowRoutes(
      prisma,
      filter,
      projectId,
      compared.window,
      page,
      pageSize
    );
    return reply.send(result);
  });

  app.get("/performance/slow-pages", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
      page?: string;
      pageSize?: string;
      limit?: string;
    };
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parsePerformanceMetricsAnchor(queryString(query.metricsUntil));
    const page = parsePositivePage(queryString(query.page), 1);
    const pageSize = parseListPageSize(queryString(query.pageSize), queryString(query.limit));

    const filter = buildPerformanceFilter({
      appId,
      platform,
      environment,
      release,
      range,
    });
    const baseWindow = resolvePerformanceSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(baseWindow, {
      compare: queryString(query.compare),
      compareFrom: queryString(query.compareFrom),
      compareTo: queryString(query.compareTo),
    });
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const result = await fetchSlowPages(
      prisma,
      filter,
      projectId,
      compared.window,
      page,
      pageSize
    );
    return reply.send(result);
  });

  app.get("/search", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      q?: string | string[];
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      metricsUntil?: string;
    };
    const q = queryString(query.q) ?? "";
    const parsed = parseGlobalSearchQuery(q);
    const appId = queryApp(query.app);

    // Date range: structured from/to/range in `q` override URL params when present.
    const dateQuery =
      parsed.filters.from || parsed.filters.to || parsed.filters.range
        ? {
            range: parsed.filters.range,
            from: parsed.filters.from,
            to: parsed.filters.to,
          }
        : {
            range: queryString(query.range),
            from: queryString(query.from),
            to: queryString(query.to),
          };
    const range = parseCreatedRange(dateQuery, "all");
    // Sessions/users: same open-ended anchoring as Sessions list (metricsUntil → ~7d).
    const metricsAnchor = parseSessionsMetricsAnchor(queryString(query.metricsUntil));
    const sessionStartedAt = resolveSessionListStartedAtBounds(range, metricsAnchor);
    // Events: same open-ended ~7d window as Events list (`enrichEventListFilterForMetrics`).
    const eventsMetrics = enrichEventListFilterForMetrics(
      { range },
      range,
      metricsAnchor
    );
    const eventCreatedAt = {
      gte: range.gte ?? eventsMetrics.eventCountRange?.gte,
      lte: range.lte ?? eventsMetrics.eventCountRange?.lte,
    };
    // Issues: occurrence window when release/platform scoped (open-ended → metrics window).
    const errorsMetrics = enrichErrorListFilterForMetrics(
      { range, status: "all" },
      range,
      metricsAnchor
    );
    const errorOccurrenceRange = {
      gte: range.gte ?? errorsMetrics.occurrenceCountRange?.gte,
      lte: range.lte ?? errorsMetrics.occurrenceCountRange?.lte,
    };

    const scope = {
      ...mergeGlobalSearchScope({
        parsed,
        appId,
        environment: queryString(query.environment),
        platform: queryString(query.platform),
        release: queryString(query.release),
        range,
      }),
      sessionStartedAt,
      eventCreatedAt,
      errorOccurrenceRange,
    };

    const result = await executeGlobalSearch(prisma, projectId, parsed, scope);
    return reply.send(result);
  });

  app.get("/releases/summary", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      metricsUntil?: string;
      sort?: string;
      order?: string;
    };
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseReleasesMetricsAnchor(queryString(query.metricsUntil));
    const sortParsed = parseReleasesSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.code(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseReleasesOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.code(400).send({ error: "Invalid order" });
    }

    const filter = buildReleasesFilter({
      appId,
      platform,
      environment,
      range,
    });
    const window = resolveReleasesSummaryWindow(range, metricsAnchor);
    const summary = await fetchReleasesPageSummary(
      prisma,
      filter,
      projectId,
      window,
      sortParsed.sort,
      orderParsed.order
    );
    return reply.send(summary);
  });

  app.get("/sessions/summary", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      country?: string;
      q?: string;
      metricsUntil?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const country = queryString(query.country);
    const q = queryString(query.q);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseSessionsMetricsAnchor(queryString(query.metricsUntil));

    const filter = buildSessionListFilter({
      appId,
      platform,
      environment,
      release,
      country,
      q,
      range,
    });
    const baseWindow = resolveSessionsSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const summary = await fetchSessionsPageSummary(
      prisma,
      filter,
      projectId,
      compared.window
    );
    return reply.send(summary);
  });

  app.get("/sessions/analytics", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      country?: string;
      q?: string;
      metricsUntil?: string;
      chartBucket?: string;
      compare?: string;
      compareFrom?: string;
      compareTo?: string;
    };
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const country = queryString(query.country);
    const q = queryString(query.q);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseSessionsMetricsAnchor(queryString(query.metricsUntil));
    const chartBucket = parseChartBucketParam(queryString(query.chartBucket));

    const filter = buildSessionListFilter({
      appId,
      platform,
      environment,
      release,
      country,
      q,
      range,
    });
    const baseWindow = resolveSessionsSummaryWindow(range, metricsAnchor);
    const compared = applySummaryCompare(
      baseWindow,
      {
        compare: queryString(query.compare),
        compareFrom: queryString(query.compareFrom),
        compareTo: queryString(query.compareTo),
      }
    );
    if (!compared.ok) {
      return reply.status(400).send({ error: compared.error });
    }
    const analytics = await fetchSessionsAnalytics(
      prisma,
      filter,
      projectId,
      compared.window,
      chartBucket
    );
    return reply.send(analytics);
  });

  app.get("/sessions", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const query = request.query as {
      app?: string | string[];
      page?: string;
      pageSize?: string;
      limit?: string;
      range?: string;
      from?: string;
      to?: string;
      platform?: string;
      environment?: string;
      release?: string;
      country?: string;
      q?: string;
      sort?: string;
      order?: string;
      metricsUntil?: string;
    };
    const pageSize = parseListPageSize(query.pageSize, query.limit);
    const page = parsePositivePage(query.page, 1);
    const skip = (page - 1) * pageSize;
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const environment = queryString(query.environment);
    const release = queryString(query.release);
    const country = queryString(query.country);
    const q = queryString(query.q);
    const range = parseCreatedRange(query, "all");
    const metricsAnchor = parseSessionsMetricsAnchor(queryString(query.metricsUntil));
    const sortParsed = parseSessionListSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.status(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseSessionListOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.status(400).send({ error: "Invalid order" });
    }

    const filter = buildSessionListFilter({
      appId,
      platform,
      environment,
      release,
      country,
      q,
      range,
    });
    const startedAt = resolveSessionListStartedAtBounds(range, metricsAnchor);
    const { total, rows, maxDurationSec } = await listSessionsEnriched(
      prisma,
      filter,
      projectId,
      startedAt,
      sortParsed.sort,
      orderParsed.order,
      skip,
      pageSize
    );
    return reply.send({
      items: rows.map((row) => serializeSessionListItem(row, maxDurationSec)),
      total,
      page,
      pageSize,
      max_duration_sec: maxDurationSec,
    });
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { id } = request.params;
    const session = await prisma.session.findFirst({
      where: whereSessionById(id, projectId),
    });
    if (!session) return reply.status(404).send({ error: "Not found" });
    const enriched = await fetchSessionEnrichedById(prisma, projectId, session.id);
    if (!enriched) return reply.status(404).send({ error: "Not found" });
    return reply.send(serializeSessionListItem(enriched));
  });

  app.get("/filter-options", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const appFilter = queryApp((request.query as { app?: string | string[] }).app);
    const baseEvent: Prisma.EventWhereInput = appFilter
      ? { ...whereEventProject(projectId), app: appFilter }
      : whereEventProject(projectId);
    const baseSession: Prisma.SessionWhereInput = appFilter
      ? { ...whereSessionProject(projectId), app: appFilter }
      : whereSessionProject(projectId);

    const errorGroupWhere = appFilter
      ? { project_id: projectId, app: appFilter }
      : { project_id: projectId };

    const [
      environments,
      platEvents,
      platSessions,
      platErrors,
      relEvents,
      relSessions,
      relErrors,
      countrySessions,
    ] = await Promise.all([
      distinctEnvironmentsForProject(prisma, projectId, appFilter),
      prisma.event.groupBy({
        by: ["platform"],
        where: { ...baseEvent, platform: { not: null } },
      }),
      prisma.session.groupBy({
        by: ["platform"],
        where: { ...baseSession, platform: { not: null } },
      }),
      prisma.errorOccurrence.groupBy({
        by: ["platform"],
        where: {
          platform: { not: null },
          error_group: errorGroupWhere,
        },
      }),
      prisma.event.groupBy({
        by: ["release"],
        where: { ...baseEvent, release: { not: null } },
      }),
      prisma.session.groupBy({
        by: ["release"],
        where: { ...baseSession, release: { not: null } },
      }),
      prisma.errorOccurrence.groupBy({
        by: ["release"],
        where: {
          release: { not: null },
          error_group: errorGroupWhere,
        },
      }),
      prisma.session.groupBy({
        by: ["country"],
        where: { ...baseSession, country: { not: null } },
      }),
    ]);

    const platforms = [
      ...new Set([
        ...platEvents.map((r) => r.platform).filter(Boolean) as string[],
        ...platSessions.map((r) => r.platform).filter(Boolean) as string[],
        ...platErrors.map((r) => r.platform).filter(Boolean) as string[],
      ]),
    ].sort();
    const releases = [
      ...new Set([
        ...relEvents.map((r) => r.release).filter(Boolean) as string[],
        ...relSessions.map((r) => r.release).filter(Boolean) as string[],
        ...relErrors.map((r) => r.release).filter(Boolean) as string[],
      ]),
    ].sort();
    const countries = countrySessions
      .map((r) => r.country)
      .filter((x): x is string => x != null && x !== "")
      .sort();

    return reply.send({ environments, platforms, releases, countries });
  });

  app.get("/apps", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const headerOrg = readOrganizationIdHeader(request);
    if (headerOrg) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, deleted_at: null },
        select: { organization_id: true },
      });
      if (!row || row.organization_id.toLowerCase() !== headerOrg.toLowerCase()) {
        return reply.status(403).send({ error: "Project is not in the selected organization" });
      }
    }
    const apps = await distinctAppsForProject(prisma, projectId);
    return reply.send({ apps });
  });

  app.get("/apps/nav-summary", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const headerOrg = readOrganizationIdHeader(request);
    if (headerOrg) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, deleted_at: null },
        select: { organization_id: true },
      });
      if (!row || row.organization_id.toLowerCase() !== headerOrg) {
        return reply.status(403).send({ error: "Project is not in the selected organization" });
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summaries = await getAppNavSummariesForProject(prisma, projectId, since);
    return reply.send({ summaries });
  });
}
