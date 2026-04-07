import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  fetchMetricsForGroupIds,
  isAggregateSort,
  listErrorGroupsAggregated,
  listErrorGroupsPrisma,
  parseErrorListOrderParam,
  parseErrorListSortParam,
  parseTrendWindowParam,
  serializeErrorGroupListItem,
  type ErrorListFilterInput,
  type ScalarErrorListSort,
} from "../lib/errors-list-query.js";
import { parseCreatedRange } from "../lib/list-query.js";
import { buildEventWhereSql } from "../lib/list-query-helpers.js";
import { getOverviewTimeSeries } from "../lib/overview-timeseries.js";
import {
  whereErrorGroupById,
  whereErrorGroupProject,
  whereErrorOccurrencePreviousWindow,
  whereErrorOccurrenceSince,
  whereEventById,
  whereEventProject,
  whereSessionById,
  whereSessionProject,
} from "../lib/prisma-project-scope.js";
import {
  resolveMemberProjectId,
  resolveReadProjectId,
} from "../lib/read-project-request.js";
import {
  EVENT_SORT_SQL,
  eventListOrderBy,
  overviewErrorOrderBy,
  parseEventListSortParam,
  parseListOrderParam,
  parseOverviewErrorSortParam,
  parseOverviewTopEventsSortParam,
  parseSessionListSortParam,
  sessionListOrderBy,
} from "../lib/list-sort-params.js";

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

async function countDistinctEventNames(
  since: Date,
  appFilter: string | undefined,
  projectId: string
): Promise<number> {
  if (appFilter) {
    const r = await prisma.$queryRaw<[{ c: bigint }]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS c FROM (
        SELECT name FROM "Event" WHERE project_id = ${projectId} AND created_at >= ${since} AND app = ${appFilter}
        GROUP BY name
      ) t`
    );
    return Number(r[0]?.c ?? 0);
  }
  const r = await prisma.$queryRaw<[{ c: bigint }]>(
    Prisma.sql`SELECT COUNT(*)::bigint AS c FROM (
      SELECT name FROM "Event" WHERE project_id = ${projectId} AND created_at >= ${since}
      GROUP BY name
    ) t`
  );
  return Number(r[0]?.c ?? 0);
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

function parseRange(range?: string): { since: Date; previousSince: Date; label: string } {
  const hours = range === "7d" ? 7 * 24 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - hours * 60 * 60 * 1000);
  const label = range === "7d" ? "7d" : "24h";
  return { since, previousSince, label };
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
      app?: string | string[];
      errorsPage?: string;
      eventsPage?: string;
      listPageSize?: string;
      errorsSort?: string;
      errorsOrder?: string;
      topEventsSort?: string;
      topEventsOrder?: string;
    };
    const range = query.range === "7d" ? "7d" : "24h";
    const appFilter = queryApp(query.app);
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
    const { since, previousSince, label } = parseRange(range);
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

    const baseWhere = { ...whereEventProject(projectId), created_at: { gte: since } };
    const eventWhere = appFilter
      ? { ...baseWhere, app: appFilter }
      : baseWhere;
    const errorGroupWhere = appFilter
      ? {
          ...whereErrorGroupProject(projectId),
          last_seen: { gte: since },
          app: appFilter,
        }
      : { ...whereErrorGroupProject(projectId), last_seen: { gte: since } };
    const errorOccurrenceWhere = whereErrorOccurrenceSince(
      projectId,
      since,
      appFilter
    );
    const previousErrorWhere = whereErrorOccurrencePreviousWindow(
      projectId,
      previousSince,
      since,
      appFilter
    );
    const previousEventWhere = appFilter
      ? {
          ...whereEventProject(projectId),
          created_at: { gte: previousSince, lt: since },
          app: appFilter,
        }
      : {
          ...whereEventProject(projectId),
          created_at: { gte: previousSince, lt: since },
        };

    const rangeKey = range === "7d" ? "7d" : "24h";

    const [
      errorsCount,
      eventsCount,
      errorsListTotal,
      eventsListTotal,
      errorGroups,
      eventCounts,
      errorsPrevious,
      eventsPrevious,
      series,
    ] = await Promise.all([
      prisma.errorOccurrence.count({ where: errorOccurrenceWhere }),
      prisma.event.count({ where: eventWhere }),
      prisma.errorGroup.count({ where: errorGroupWhere }),
      countDistinctEventNames(since, appFilter, projectId),
      prisma.errorGroup.findMany({
        where: errorGroupWhere,
        skip: errorsSkip,
        take: listPageSize,
        orderBy: errorGroupOrderBy,
        include: { _count: { select: { occurrences_list: true } } },
      }),
      prisma.event.groupBy({
        by: ["name"],
        where: eventWhere,
        _count: { name: true },
        orderBy: eventGroupByOrderBy,
        skip: eventsSkip,
        take: listPageSize,
      }),
      prisma.errorOccurrence.count({ where: previousErrorWhere }),
      prisma.event.count({ where: previousEventWhere }),
      getOverviewTimeSeries(prisma, projectId, rangeKey, since, appFilter),
    ]);

    const topEvents = await Promise.all(
      eventCounts.map(async (row: { name: string; _count: { name: number } }) => {
        const latest = await prisma.event.findFirst({
          where: { ...eventWhere, name: row.name },
          orderBy: { created_at: "desc" },
          select: {
            app: true,
            platform: true,
            environment: true,
            release: true,
            created_at: true,
          },
        });
        return {
          name: row.name,
          count: row._count.name,
          app: latest?.app ?? "",
          platform: latest?.platform ?? null,
          environment: latest?.environment ?? null,
          release: latest?.release ?? null,
          lastSeen: latest?.created_at.toISOString() ?? null,
        };
      })
    );

    return reply.send({
      range: label,
      since: since.toISOString(),
      errorsLast24h: errorsCount,
      eventsLast24h: eventsCount,
      errorsPrevious,
      eventsPrevious,
      topErrorGroups: errorGroups,
      topEvents,
      errorsListTotal,
      eventsListTotal,
      errorsPage,
      eventsPage,
      listPageSize,
      series,
    });
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
      q?: string;
      status?: string;
      sort?: string;
      order?: string;
      trendWindow?: string;
    };
    const pageSize = parseListPageSize(query.pageSize, query.limit);
    const page = parsePositivePage(query.page, 1);
    const skip = (page - 1) * pageSize;
    const appId = queryApp(query.app);
    const environment = queryString(query.environment);
    const q = queryString(query.q);
    const status = queryString(query.status) ?? "all";
    const range = parseCreatedRange(query, "all");

    const sortParsed = parseErrorListSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.status(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseErrorListOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.status(400).send({ error: "Invalid order" });
    }
    const trendWindowParsed = parseTrendWindowParam(queryString(query.trendWindow));
    if (!trendWindowParsed.ok) {
      return reply.status(400).send({ error: "Invalid trendWindow" });
    }

    const trendEnd = range.lte ?? new Date();

    const filter: ErrorListFilterInput = {
      appId,
      environment,
      q,
      range,
      status:
        status === "unresolved"
          ? "unresolved"
          : status === "resolved"
            ? "resolved"
            : "all",
    };

    if (isAggregateSort(sortParsed.sort)) {
      const { total, rows } = await listErrorGroupsAggregated(
        prisma,
        filter,
        projectId,
        sortParsed.sort,
        orderParsed.order,
        trendWindowParsed.trendWindow,
        trendEnd,
        skip,
        pageSize
      );
      const items = rows.map((r) => serializeErrorGroupListItem(r));
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
      trendWindowParsed.trendWindow,
      trendEnd
    );
    const items = groups.map((g) => {
      const m = metrics.get(g.id);
      return {
        ...g,
        users_affected: m?.users_affected ?? 0,
        sessions_affected: m?.sessions_affected ?? 0,
        occurrences_recent: m?.occurrences_recent ?? 0,
        occurrences_previous: m?.occurrences_previous ?? 0,
        trend_ratio: m?.trend_ratio ?? 0,
      };
    });
    return reply.send({ items, total, page, pageSize });
  });

  app.patch<{ Params: { id: string } }>("/errors/:id", async (request, reply) => {
    const projectId = await resolveMemberProjectId(request, reply);
    if (projectId === null) return;
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
    const group = await prisma.errorGroup.findFirst({
      where: whereErrorGroupById(id, projectId),
      include: {
        occurrences_list: {
          orderBy: { created_at: "desc" },
          take: 50,
        },
      },
    });
    if (!group) return reply.status(404).send({ error: "Not found" });
    return reply.send(group);
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
      sort?: string;
      order?: string;
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
    const range = parseCreatedRange(query, "all");
    const sortParsed = parseEventListSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.status(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseListOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.status(400).send({ error: "Invalid order" });
    }
    const eventOrderBy = eventListOrderBy(sortParsed.sort, orderParsed.order);
    const orderDirSql =
      orderParsed.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const props = propertiesContains?.trim();
    if (props) {
      const whereSql = buildEventWhereSql({
        projectId,
        appId,
        name,
        environment,
        platform,
        release,
        gte: range.gte,
        lte: range.lte,
        propertiesContains: props,
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
      return reply.send({ items: rows, total, page, pageSize });
    }

    const where: Prisma.EventWhereInput = whereEventProject(projectId);
    if (appId) where.app = appId;
    if (name) where.name = name;
    if (environment) where.environment = environment;
    if (platform) where.platform = platform;
    if (release) where.release = release;
    if (range.gte || range.lte) {
      where.created_at = {};
      if (range.gte) where.created_at.gte = range.gte;
      if (range.lte) where.created_at.lte = range.lte;
    }
    const [total, list] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: eventOrderBy,
      }),
    ]);
    return reply.send({ items: list, total, page, pageSize });
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
      sort?: string;
      order?: string;
    };
    const pageSize = parseListPageSize(query.pageSize, query.limit);
    const page = parsePositivePage(query.page, 1);
    const skip = (page - 1) * pageSize;
    const appId = queryApp(query.app);
    const platform = queryString(query.platform);
    const range = parseCreatedRange(query, "24h");
    const sortParsed = parseSessionListSortParam(queryString(query.sort));
    if (!sortParsed.ok) {
      return reply.status(400).send({ error: "Invalid sort" });
    }
    const orderParsed = parseListOrderParam(queryString(query.order));
    if (!orderParsed.ok) {
      return reply.status(400).send({ error: "Invalid order" });
    }
    const sessionOrderBy = sessionListOrderBy(sortParsed.sort, orderParsed.order);

    const where: Prisma.SessionWhereInput = whereSessionProject(projectId);
    if (appId) where.app = appId;
    if (platform) where.platform = platform;
    if (range.gte || range.lte) {
      where.started_at = {};
      if (range.gte) where.started_at.gte = range.gte;
      if (range.lte) where.started_at.lte = range.lte;
    }
    const [total, list] = await Promise.all([
      prisma.session.count({ where }),
      prisma.session.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: sessionOrderBy,
      }),
    ]);
    return reply.send({ items: list, total, page, pageSize });
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { id } = request.params;
    const session = await prisma.session.findFirst({
      where: whereSessionById(id, projectId),
    });
    if (!session) return reply.status(404).send({ error: "Not found" });
    return reply.send(session);
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
    const baseError: Prisma.ErrorGroupWhereInput = appFilter
      ? { ...whereErrorGroupProject(projectId), app: appFilter }
      : whereErrorGroupProject(projectId);

    const [
      envEvents,
      envErrors,
      platEvents,
      platSessions,
      relEvents,
    ] = await Promise.all([
      prisma.event.groupBy({
        by: ["environment"],
        where: { ...baseEvent, environment: { not: null } },
      }),
      prisma.errorGroup.groupBy({
        by: ["environment"],
        where: { ...baseError, environment: { not: null } },
      }),
      prisma.event.groupBy({
        by: ["platform"],
        where: { ...baseEvent, platform: { not: null } },
      }),
      prisma.session.groupBy({
        by: ["platform"],
        where: { ...baseSession, platform: { not: null } },
      }),
      prisma.event.groupBy({
        by: ["release"],
        where: { ...baseEvent, release: { not: null } },
      }),
    ]);

    const environments = [
      ...new Set([
        ...envEvents.map((r) => r.environment).filter(Boolean) as string[],
        ...envErrors.map((r) => r.environment).filter(Boolean) as string[],
      ]),
    ].sort();
    const platforms = [
      ...new Set([
        ...platEvents.map((r) => r.platform).filter(Boolean) as string[],
        ...platSessions.map((r) => r.platform).filter(Boolean) as string[],
      ]),
    ].sort();
    const releases = relEvents
      .map((r) => r.release)
      .filter((x): x is string => x != null && x !== "")
      .sort();

    return reply.send({ environments, platforms, releases });
  });

  app.get("/apps", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const [eventsApps, errorsApps, sessionsApps] = await Promise.all([
      prisma.event.groupBy({
        by: ["app"],
        where: whereEventProject(projectId),
      }),
      prisma.errorGroup.groupBy({
        by: ["app"],
        where: whereErrorGroupProject(projectId),
      }),
      prisma.session.groupBy({
        by: ["app"],
        where: whereSessionProject(projectId),
      }),
    ]);
    const apps = [
      ...new Set([
        ...eventsApps.map((e) => e.app),
        ...errorsApps.map((e) => e.app),
        ...sessionsApps.map((s) => s.app),
      ]),
    ].sort();
    return reply.send({ apps });
  });
}
