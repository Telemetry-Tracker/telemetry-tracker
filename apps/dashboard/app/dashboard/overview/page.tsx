import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Badge } from "@/app/components/Badge";
import { EmptyState } from "@/app/components/EmptyState";
import { TimeAgo } from "@/app/components/TimeAgo";
import { ErrorState } from "@/app/components/ErrorState";
import { OverviewTopBars } from "@/app/components/dashboard/OverviewTopBars";
import {
  mapErrorGroupsToBarRows,
  mapTopEventsToBarRows,
} from "@/lib/overview-bar-rows";
import { OverviewSortControls } from "@/app/components/dashboard/OverviewSortControls";
import { OverviewTrendsChart } from "@/app/components/dashboard/OverviewTrendsChart";
import { TimeRangePicker } from "@/app/components/dashboard/TimeRangePicker";
import { Pagination } from "@/app/components/ui/Pagination";
import { DashboardSection, StatCard } from "@/app/components/dashboard/dashboard-ui";
import {
  AnalyticsViewAllLink,
} from "@/app/components/dashboard/analytics-ui";
import { IssueList, OverviewListItem } from "@/app/components/dashboard/IssueList";
import { OverviewGreeting } from "@/app/components/dashboard/overview/OverviewGreeting";
import { OverviewIngestSetupBanner } from "@/app/components/dashboard/overview/OverviewIngestSetupBanner";
import type { ProjectAppDto } from "@/app/dashboard/actions";
import { resolveOverviewSetupBanner } from "@/lib/connect-app-setup";
import { OverviewApiResponseLogger } from "@/app/components/dashboard/overview/OverviewApiResponseLogger";
import { OverviewScopeBanner } from "@/app/components/dashboard/overview/OverviewScopeBanner";
import { OverviewScopeFilters } from "@/app/components/dashboard/overview/OverviewScopeFilters";
import { OverviewAppHealth } from "@/app/components/dashboard/overview/OverviewAppHealth";
import { OverviewActiveIncidents } from "@/app/components/dashboard/overview/OverviewActiveIncidents";
import { OverviewMetricsSection } from "@/app/components/dashboard/overview/OverviewMetricsSection";
import { OverviewExtraCharts } from "@/app/components/dashboard/overview/OverviewExtraCharts";
import {
  OverviewRecentSessionsPanel,
  OverviewTopErrorsPanel,
} from "@/app/components/dashboard/overview/OverviewBreakdownGrid";
import { OverviewPerformanceCard } from "@/app/components/dashboard/overview/OverviewPerformanceCard";
import { mergeListQuery, redirectHrefIfMissingTimeRange, redirectHrefForMetricsUntil } from "@/lib/list-filters-url";
import { parseOverviewListPageSize, parsePageParam } from "@/lib/pagination";
import type { OverviewApiResponse, OverviewHealth, OverviewKpiSparklines, OverviewWorkspaceTelemetry } from "@/lib/overview-api";
import { buildOverviewWorkspaceStats } from "@/lib/overview-workspace-stats";
import {
  parseOverviewCompare,
  isRollingCompareParam,
  resolveScopedQueryValue,
  compareLabelFor,
  buildErrorGroupDetailHref,
  buildDashboardScopedListHref,
  buildEventListHref,
  formatOverviewDeltaLine,
  type DashboardListScope,
} from "@/lib/overview-scope-url";
import type { ParsedTimeRange } from "@/lib/time-range";
import {
  parseOverviewTimeRangeQuery,
  isUnselectedTimeRange,
  effectiveIngestRateDurationMs,
  appendListTimeRangeToParams,
  resolveMetricsUntilIso,
} from "@/lib/time-range";
import { firstQueryValue } from "@/lib/search-params";
import { coalesceOverviewRequest } from "@/lib/api-inflight";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import { dashboardDebug } from "@/lib/dashboard-debug";
import { fetchDashboardBootstrap } from "@/lib/dashboard-bootstrap-server";
import { getDashboardUser } from "@/lib/dashboard-user";
import {
  fetchDashboardEnvironments,
  fetchDashboardNavScope,
  getDashboardWorkspaceForRequest,
} from "@/lib/dashboard-workspace-request";
import {
  overviewScopeMatches,
  readOverviewCookieScope,
  shouldReuseOverviewEarlyFetch,
  type OverviewRequestScope,
} from "@/lib/overview-request-scope";

export const dynamic = "force-dynamic";

const OVERVIEW_PATH = "/dashboard/overview";

async function loadProjectAppsForSetupBanner(): Promise<ProjectAppDto[]> {
  try {
    const res = await dashboardApiFetch("/api/project/apps");
    if (!res.ok) return [];
    const data = (await res.json()) as { apps?: ProjectAppDto[] };
    return data.apps ?? [];
  } catch {
    return [];
  }
}

async function getOverview(
  parsedRange: ParsedTimeRange,
  timeFromTo: { from?: string; to?: string },
  app: string | undefined,
  environment: string | undefined,
  platform: string | undefined,
  release: string | undefined,
  compare: string,
  list: {
    errorsPage: number;
    eventsPage: number;
    listPageSize: number;
    errorsSort: string;
    errorsOrder: string;
    topEventsSort: string;
    topEventsOrder: string;
  },
  scope: OverviewRequestScope,
  metricsUntil?: string,
  compareBounds?: { compareFrom?: string; compareTo?: string }
) {
  const params = new URLSearchParams();
  appendListTimeRangeToParams(params, parsedRange, timeFromTo.from, timeFromTo.to);
  if (app) params.set("app", app);
  if (environment) params.set("environment", environment);
  if (platform) params.set("platform", platform);
  if (release) params.set("release", release);
  if (compare && compare !== "previous") params.set("compare", compare);
  if (compareBounds?.compareFrom) params.set("compareFrom", compareBounds.compareFrom);
  if (compareBounds?.compareTo) params.set("compareTo", compareBounds.compareTo);
  if (metricsUntil) params.set("metricsUntil", metricsUntil);
  params.set("errorsPage", String(list.errorsPage));
  params.set("eventsPage", String(list.eventsPage));
  params.set("listPageSize", String(list.listPageSize));
  params.set("errorsSort", list.errorsSort);
  params.set("errorsOrder", list.errorsOrder);
  params.set("topEventsSort", list.topEventsSort);
  params.set("topEventsOrder", list.topEventsOrder);
  const path = `/api/overview?${params.toString()}`;
  const cacheKey = `${scope.projectId}:${scope.organizationId ?? ""}:${path}`;

  return coalesceOverviewRequest(cacheKey, async () => {
    const started = Date.now();
    dashboardDebug("overview", "fetch start", { cacheKey });
    const res = await dashboardApiFetch(path, undefined, {
      projectIdOverride: scope.projectId,
      ...(scope.organizationId
        ? { organizationIdOverride: scope.organizationId }
        : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      dashboardDebug("overview", "fetch failed", {
        status: res.status,
        ms: Date.now() - started,
        body: text.slice(0, 300),
      });
      throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
    }
    dashboardDebug("overview", "fetch ok", { ms: Date.now() - started });
    const body = (await res.json()) as OverviewApiResponse;
    dashboardDebug("overview", "response", {
      range: body.range,
      since: body.since,
      errorsLast24h: body.errorsLast24h,
      eventsLast24h: body.eventsLast24h,
      topErrorGroups: body.topErrorGroups?.length ?? 0,
      topEvents: body.topEvents?.length ?? 0,
      seriesPoints: body.series?.errors?.length ?? 0,
    });
    return body;
  });
}

function emptySeries(): OverviewApiResponse["series"] {
  return {
    bucket: "hour",
    errors: [],
    events: [],
    sessions: [],
  };
}

function emptySparklines(): OverviewKpiSparklines {
  return {
    errors: [],
    events: [],
    sessions: [],
  };
}

function buildOverviewParamsRecord(
  sp: Record<string, string | string[] | undefined>
): Record<string, string> {
  const keys = [
    "range",
    "from",
    "to",
    "metricsUntil",
    "app",
    "environment",
    "platform",
    "release",
    "compare",
    "compareFrom",
    "compareTo",
    "errorsPage",
    "eventsPage",
    "listPageSize",
    "errorsSort",
    "errorsOrder",
    "topEventsSort",
    "topEventsOrder",
  ] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = firstQueryValue(sp[k]);
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

function buildOverviewListScope(
  app: string | null,
  environment: string | null,
  platform: string | null,
  release: string | null,
  timeQuery: { range?: string; from?: string; to?: string },
  metricsUntil?: string | null,
  compare?: {
    compare?: string | null;
    compareFrom?: string | null;
    compareTo?: string | null;
  }
): DashboardListScope {
  return {
    app,
    environment,
    platform,
    release,
    range: timeQuery.range ?? null,
    from: timeQuery.from ?? null,
    to: timeQuery.to ?? null,
    ...(metricsUntil ? { metricsUntil } : {}),
    ...(compare?.compare && compare.compare !== "previous"
      ? { compare: compare.compare }
      : {}),
    ...(compare?.compareFrom ? { compareFrom: compare.compareFrom } : {}),
    ...(compare?.compareTo ? { compareTo: compare.compareTo } : {}),
  };
}

async function getFilterOptions(app?: string) {
  const p = new URLSearchParams();
  if (app) p.set("app", app);
  const res = await dashboardApiFetch(`/api/filter-options?${p.toString()}`);
  if (!res.ok) {
    return { platforms: [] as string[], releases: [] as string[] };
  }
  const data = (await res.json()) as { platforms?: string[]; releases?: string[] };
  return {
    platforms: data.platforms ?? [],
    releases: data.releases ?? [],
  };
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    from?: string | string[];
    to?: string | string[];
    metricsUntil?: string | string[];
    app?: string | string[];
    environment?: string | string[];
    platform?: string | string[];
    release?: string | string[];
    compare?: string | string[];
    compareFrom?: string | string[];
    compareTo?: string | string[];
    errorsPage?: string | string[];
    eventsPage?: string | string[];
    listPageSize?: string | string[];
    errorsSort?: string | string[];
    errorsOrder?: string | string[];
    topEventsSort?: string | string[];
    topEventsOrder?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const timeQuery = {
    range: firstQueryValue(params.range),
    from: firstQueryValue(params.from),
    to: firstQueryValue(params.to),
  };
  let currentOverviewParams = buildOverviewParamsRecord(params);
  const defaultTimeHref = redirectHrefIfMissingTimeRange(
    OVERVIEW_PATH,
    currentOverviewParams
  );
  if (defaultTimeHref) redirect(defaultTimeHref);
  const timeParse = parseOverviewTimeRangeQuery(timeQuery);
  if (!timeParse.ok) {
    redirect(
      mergeListQuery(OVERVIEW_PATH, currentOverviewParams, {
        range: null,
        from: null,
        to: null,
      })
    );
  }
  const parsedRange = timeParse.range;
  const pageMetricsUntil = isUnselectedTimeRange(parsedRange.key)
    ? resolveMetricsUntilIso(firstQueryValue(params.metricsUntil))
    : undefined;
  const metricsUntilHref = redirectHrefForMetricsUntil(
    OVERVIEW_PATH,
    currentOverviewParams,
    parsedRange.key,
    pageMetricsUntil
  );
  if (metricsUntilHref) redirect(metricsUntilHref);
  // Align client nav with the API: set anchor for open-ended ranges, clear stale ones.
  if (pageMetricsUntil) {
    currentOverviewParams = {
      ...currentOverviewParams,
      metricsUntil: pageMetricsUntil,
    };
  } else if (currentOverviewParams.metricsUntil) {
    const { metricsUntil: _stale, ...withoutMetricsUntil } = currentOverviewParams;
    currentOverviewParams = withoutMetricsUntil;
  }
  const rawApp = firstQueryValue(params.app)?.trim() || null;
  const rawEnvironment = firstQueryValue(params.environment)?.trim() || null;
  const rawPlatform = firstQueryValue(params.platform)?.trim() || null;
  const rawRelease = firstQueryValue(params.release)?.trim() || null;
  const compare = parseOverviewCompare(firstQueryValue(params.compare));
  const compareFrom = firstQueryValue(params.compareFrom) ?? undefined;
  const compareTo = firstQueryValue(params.compareTo) ?? undefined;
  const errorsPage = parsePageParam(firstQueryValue(params.errorsPage));
  const eventsPage = parsePageParam(firstQueryValue(params.eventsPage));
  const listPageSize = parseOverviewListPageSize(params.listPageSize);
  const errorsSort = firstQueryValue(params.errorsSort) ?? "occurrences";
  const errorsOrder = firstQueryValue(params.errorsOrder) ?? "desc";
  const topEventsSort = firstQueryValue(params.topEventsSort) ?? "count";
  const topEventsOrder = firstQueryValue(params.topEventsOrder) ?? "desc";
  const listParams = {
    errorsPage,
    eventsPage,
    listPageSize,
    errorsSort,
    errorsOrder,
    topEventsSort,
    topEventsOrder,
  };

  const cookieScope = await readOverviewCookieScope();
  const pageStarted = Date.now();

  const overviewEarlyPromise =
    cookieScope.projectId !== ""
      ? getOverview(
          parsedRange,
          timeQuery,
          rawApp ?? undefined,
          rawEnvironment ?? undefined,
          rawPlatform ?? undefined,
          rawRelease ?? undefined,
          compare,
          listParams,
          cookieScope,
          pageMetricsUntil,
          { compareFrom, compareTo }
        ).catch((e) => ({ error: e } as const))
      : Promise.resolve({ error: new Error("No project selected") } as const);

  const [user, workspace, bootstrap, overviewEarly, filterOptionsEarly] = await Promise.all([
    getDashboardUser(),
    getDashboardWorkspaceForRequest(),
    fetchDashboardBootstrap(),
    overviewEarlyPromise,
    getFilterOptions(rawApp ?? undefined),
  ]);
  const { organizations, projects, resolvedOrgId, effectiveProjectId } = workspace;

  dashboardDebug("overview", "parallel shell done", {
    ms: Date.now() - pageStarted,
    orgCount: organizations.length,
    projectCount: projects.length,
    resolvedOrgId,
    effectiveProjectId,
    hasUser: user !== null,
    cookieScope,
  });

  const resolvedScope: OverviewRequestScope = {
    projectId: effectiveProjectId,
    organizationId: resolvedOrgId,
  };

  let overviewResult = overviewEarly;
  if (!shouldReuseOverviewEarlyFetch(cookieScope, resolvedScope, effectiveProjectId)) {
    if (effectiveProjectId !== "") {
      dashboardDebug("overview", "refetch — scope differs from cookies", {
        cookieScope,
        resolvedScope,
      });
      overviewResult = await getOverview(
        parsedRange,
        timeQuery,
        rawApp ?? undefined,
        rawEnvironment ?? undefined,
        rawPlatform ?? undefined,
        rawRelease ?? undefined,
        compare,
        listParams,
        resolvedScope,
        pageMetricsUntil,
        { compareFrom, compareTo }
      ).catch((e) => ({ error: e } as const));
    } else {
      overviewResult = { error: new Error("No project selected") } as const;
    }
  }

  const apps =
    effectiveProjectId === ""
      ? []
      : overviewScopeMatches(cookieScope, resolvedScope)
        ? (bootstrap?.navScope.apps ?? [])
        : (await fetchDashboardNavScope(effectiveProjectId, resolvedOrgId)).apps;

  const app = resolveScopedQueryValue(rawApp, apps);
  if (rawApp !== app) {
    redirect(mergeListQuery(OVERVIEW_PATH, currentOverviewParams, { app }));
  }

  const scopedEnvironments =
    effectiveProjectId === ""
      ? []
      : overviewScopeMatches(cookieScope, resolvedScope) && !app
        ? (bootstrap?.navScope.environments ?? [])
        : await fetchDashboardEnvironments(effectiveProjectId, resolvedOrgId, app);

  const environment = resolveScopedQueryValue(rawEnvironment, scopedEnvironments);
  if (rawEnvironment !== environment) {
    redirect(
      mergeListQuery(OVERVIEW_PATH, currentOverviewParams, { environment })
    );
  }

  const filterOptions =
    effectiveProjectId === ""
      ? { platforms: [] as string[], releases: [] as string[] }
      : app === rawApp
        ? filterOptionsEarly
        : await getFilterOptions(app ?? undefined);

  const platform = resolveScopedQueryValue(rawPlatform, filterOptions.platforms);
  if (rawPlatform !== platform) {
    redirect(mergeListQuery(OVERVIEW_PATH, currentOverviewParams, { platform }));
  }

  const release = resolveScopedQueryValue(rawRelease, filterOptions.releases);
  if (rawRelease !== release) {
    redirect(mergeListQuery(OVERVIEW_PATH, currentOverviewParams, { release }));
  }

  const listScope = buildOverviewListScope(
    app,
    environment,
    platform,
    release,
    timeQuery,
    pageMetricsUntil,
    { compare, compareFrom, compareTo }
  );

  const workspaceStats = buildOverviewWorkspaceStats(
    organizations,
    projects,
    resolvedOrgId
  );

  if ("error" in overviewResult) {
    const e = overviewResult.error;
    return (
      <>
        <OverviewGreeting user={user} />
        <ErrorState message={String(e instanceof Error ? e.message : e)} />
      </>
    );
  }

  const overviewData: OverviewApiResponse = {
    ...overviewResult,
    series: overviewResult.series ?? emptySeries(),
    kpiSparklines: overviewResult.kpiSparklines ?? emptySparklines(),
  };

  // Metrics-aligned panels (KPI top errors) use the exact Overview metrics window
  // for open-ended ranges and calendar/custom compare. Paginated list rows keep
  // the page list range unless the range is open-ended (list last_seen ≠ KPIs).
  const metricsIssueDetailScope =
    overviewData.metricsSince &&
    (overviewData.metricsUntil || pageMetricsUntil) &&
    (isUnselectedTimeRange(parsedRange.key) || !isRollingCompareParam(compare))
      ? {
          ...listScope,
          metricsSince: overviewData.metricsSince,
          metricsUntil: overviewData.metricsUntil || pageMetricsUntil,
        }
      : listScope;
  const listIssueDetailScope = isUnselectedTimeRange(parsedRange.key)
    ? metricsIssueDetailScope
    : listScope;

  // Always drive the Performance card from Overview's resolved KPI window so
  // calendar/custom compare and rolling presets (e.g. 7d) stay aligned with KPIs.
  const performanceMetricsSince = overviewData.metricsSince ?? null;
  const performanceMetricsUntil =
    overviewData.metricsUntil || pageMetricsUntil || null;

  const displayRangeLabel = overviewData.rangeLabel ?? parsedRange.label;
  const errorsDelta = overviewData.errorsLast24h - overviewData.errorsPrevious;
  const eventsDelta = overviewData.eventsLast24h - overviewData.eventsPrevious;
  const compareLabel =
    overviewData.compareLabel ?? compareLabelFor(compare, displayRangeLabel);
  const errDeltaFmt = formatOverviewDeltaLine(
    overviewData.errorsLast24h,
    overviewData.errorsPrevious,
    "errors",
    compareLabel
  );
  const evDeltaFmt = formatOverviewDeltaLine(
    overviewData.eventsLast24h,
    overviewData.eventsPrevious,
    "events",
    compareLabel
  );

  const health: OverviewHealth =
    overviewData.health ?? {
      status: "operational",
      statusLabel: "Operational",
      subtitle: "No health metrics returned",
      errorRatePct: 0,
      errorRateDeltaPct: 0,
      successRatePct: 100,
      throughputPerSec: 0,
      peakThroughputPerSec: 0,
    };
  const activeIssues = overviewData.activeIssues ?? [];
  const sessionDurationSeries = overviewData.sessionDurationSeries ?? [];
  const workspaceTelemetry: OverviewWorkspaceTelemetry = overviewData.workspaceTelemetry ?? {
    ingestRequests: overviewData.eventsLast24h + overviewData.errorsLast24h,
    sdkEventRows: overviewData.eventsLast24h,
    distinctApps: apps.length,
    distinctSdkVersions: 0,
  };

  const contextParts = isUnselectedTimeRange(parsedRange.key) ? [] : [displayRangeLabel];
  if (app) contextParts.push(`App: ${app}`);
  if (environment) contextParts.push(`Env: ${environment}`);
  if (platform) contextParts.push(`Platform: ${platform}`);
  if (release) contextParts.push(`Release: ${release}`);

  const eventsCount = overviewData.eventsListTotal ?? 0;
  const errorsCount = overviewData.errorsListTotal ?? 0;
  const projectAppsForBanner: ProjectAppDto[] =
    eventsCount === 0 && errorsCount === 0 && effectiveProjectId
      ? await loadProjectAppsForSetupBanner()
      : [];
  const setupBanner = resolveOverviewSetupBanner({
    eventsCount,
    errorsCount,
    selectedApp: app,
    projectApps: projectAppsForBanner,
  });

  return (
    <>
      <OverviewApiResponseLogger data={overviewData} />
      <OverviewIngestSetupBanner
        rangeKey={parsedRange.key}
        rangeLabel={displayRangeLabel}
        eventsCount={eventsCount}
        errorsCount={errorsCount}
        mode={setupBanner.mode}
        appName={setupBanner.appName}
      />
      <OverviewGreeting
        user={user}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TimeRangePicker
              path={OVERVIEW_PATH}
              currentParams={currentOverviewParams}
              includeAll
              align="right"
              range={{
                key: parsedRange.key,
                label: displayRangeLabel,
                shortLabel: parsedRange.shortLabel,
                gte: overviewData.since,
                lte: overviewData.until ?? parsedRange.lte.toISOString(),
              }}
            />
          </div>
        }
      />

      <OverviewScopeBanner visible={!app && apps.length > 0} />

      <OverviewScopeFilters
        path={OVERVIEW_PATH}
        currentParams={currentOverviewParams}
        platform={platform ?? ""}
        release={release ?? ""}
        platforms={filterOptions.platforms}
        releases={filterOptions.releases}
      />

      <OverviewAppHealth health={health} />

      <Suspense fallback={null}>
        <OverviewMetricsSection
          rangeLabel={displayRangeLabel}
          rangeDurationMs={
            overviewData.metricsDurationMs ?? effectiveIngestRateDurationMs(parsedRange)
          }
          overviewPath={OVERVIEW_PATH}
          currentParams={currentOverviewParams}
          eventsCount={overviewData.eventsLast24h}
          eventsPrevious={overviewData.eventsPrevious}
          errorsCount={overviewData.errorsLast24h}
          errorsPrevious={overviewData.errorsPrevious}
          sessionsCount={overviewData.sessionsCount ?? 0}
          sessionsPrevious={overviewData.sessionsPrevious ?? 0}
          activeUsers={overviewData.activeUsers ?? 0}
          activeUsersPrevious={overviewData.activeUsersPrevious ?? 0}
          workspaceStats={workspaceStats}
          workspaceTelemetry={workspaceTelemetry}
          sparklines={overviewData.kpiSparklines ?? emptySparklines()}
          requestMetrics={overviewData.requestMetrics}
          compareLabel={compareLabel}
        />
      </Suspense>

      <section className="mb-5 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OverviewTrendsChart series={overviewData.series} rangeLabel={displayRangeLabel} />
        </div>
        <OverviewTopErrorsPanel
          groups={(overviewData.metricsTopErrorGroups ?? []).map((group) => ({
            ...group,
            href: buildErrorGroupDetailHref(group.id, metricsIssueDetailScope),
          }))}
          rangeLabel={displayRangeLabel}
          errorsHref={buildDashboardScopedListHref("/dashboard/errors", listScope)}
        />
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <OverviewActiveIncidents issues={activeIssues} />
        <OverviewRecentSessionsPanel
          sessions={overviewData.recentSessions ?? []}
          rangeLabel={displayRangeLabel}
          sessionsHref={buildDashboardScopedListHref("/dashboard/sessions", listScope)}
        />
      </section>

      <section className="mb-5">
        <OverviewPerformanceCard
          listScope={listScope}
          rangeLabel={displayRangeLabel}
          metricsSince={performanceMetricsSince}
          metricsUntil={performanceMetricsUntil}
        />
      </section>

      <OverviewExtraCharts
        series={overviewData.series}
        sessionDurationSeries={sessionDurationSeries}
        rangeLabel={displayRangeLabel}
      />

      <DashboardSection
        kicker="Live telemetry"
        title="Trends & breakdown"
        description={`Project-scoped data from your telemetry API · ${contextParts.join(" · ")}`}
        className="mb-6"
      >
        <OverviewSortControls
          path={OVERVIEW_PATH}
          currentParams={currentOverviewParams}
          errorsSort={errorsSort}
          errorsOrder={errorsOrder}
          topEventsSort={topEventsSort}
          topEventsOrder={topEventsOrder}
        />

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <OverviewTopBars
            title="Top errors (this page)"
            subtitle="Occurrences in the current table page — compare at a glance"
            rows={mapErrorGroupsToBarRows(overviewData.topErrorGroups ?? [])}
            accent="errors"
            emptyMessage="No error groups recorded on this page."
          />
          <OverviewTopBars
            title="Top events (this page)"
            subtitle="Event name counts on the current table page"
            rows={mapTopEventsToBarRows(overviewData.topEvents ?? [])}
            accent="events"
            emptyMessage="No events recorded on this page."
          />
        </div>
      </DashboardSection>

      <DashboardSection
        kicker="Errors"
        title="Exception & crash signals"
        description="Error occurrences grouped by fingerprint. Higher counts usually mean more user impact."
        className="mb-6"
      >
        <StatCard
          label={`Total error occurrences · ${displayRangeLabel}`}
          value={overviewData.errorsLast24h}
          delta={errDeltaFmt.text}
          deltaTone={
            errorsDelta > 0 ? "danger" : errorsDelta < 0 ? "success" : "muted"
          }
        />

        <h3 className="text-sm font-medium">Top error groups</h3>
        {overviewData.topErrorGroups?.length ? (
          <>
            <IssueList>
            {overviewData.topErrorGroups.map(
              (g: {
                id: string;
                message: string;
                app: string;
                occurrences: number;
                last_seen: string;
              }) => (
                <OverviewListItem
                  key={g.id}
                  href={buildErrorGroupDetailHref(g.id, listIssueDetailScope)}
                  title={g.message}
                  titleClassName="font-medium text-destructive"
                  badges={<Badge>{g.app}</Badge>}
                  meta={
                    <>
                      {g.occurrences} occurrences · last{" "}
                      <TimeAgo iso={g.last_seen} className="text-muted-foreground" />
                    </>
                  }
                />
              )
            )}
          </IssueList>
            <div className="mt-3">
              <AnalyticsViewAllLink href={buildDashboardScopedListHref("/dashboard/errors", listScope)}>
                View all errors
              </AnalyticsViewAllLink>
            </div>
          </>
        ) : (
          <EmptyState
            title="No errors recorded"
            message={`Nothing matched for ${displayRangeLabel}. Try another range or app filter.`}
          />
        )}
        <Pagination
          total={overviewData.errorsListTotal ?? 0}
          page={overviewData.errorsPage ?? errorsPage}
          pageSize={overviewData.listPageSize ?? listPageSize}
          hrefForPage={(p) =>
            mergeListQuery(OVERVIEW_PATH, currentOverviewParams, {
              errorsPage: String(p),
            })
          }
        />
      </DashboardSection>

      <DashboardSection
        kicker="Events"
        title="Product & analytics events"
        description="Named events your SDK recorded. Separate from errors above."
      >
        <StatCard
          label={`Total event rows · ${displayRangeLabel}`}
          value={overviewData.eventsLast24h}
          delta={evDeltaFmt.text}
          deltaTone={
            eventsDelta > 0 ? "success" : eventsDelta < 0 ? "danger" : "muted"
          }
        />

        <h3 className="text-sm font-medium">Top event names</h3>
        {overviewData.topEvents?.length ? (
          <>
            <IssueList>
            {overviewData.topEvents.map(
              (e: {
                name: string;
                count: number;
                app: string;
                platform: string | null;
                environment: string | null;
                release: string | null;
                lastSeen: string | null;
              }) => (
                <OverviewListItem
                  key={e.name}
                  href={buildEventListHref(e.name, listScope)}
                  title={e.name}
                  badges={e.app ? <Badge>{e.app}</Badge> : null}
                  meta={
                    <>
                      <span className="tabular-nums">{e.count} in period</span>
                      {" · "}
                      {e.platform ?? "—"} · {e.environment ?? "—"}
                      {e.release ? ` · ${e.release}` : ""}
                      {e.lastSeen ? (
                        <>
                          {" · "}Last seen{" "}
                          <TimeAgo iso={e.lastSeen} className="text-muted-foreground" />
                        </>
                      ) : null}
                    </>
                  }
                />
              )
            )}
          </IssueList>
            <div className="mt-3">
              <AnalyticsViewAllLink href={buildDashboardScopedListHref("/dashboard/events", listScope)}>
                View all events
              </AnalyticsViewAllLink>
            </div>
          </>
        ) : (
          <EmptyState
            title="No events recorded"
            message={`Nothing matched for ${displayRangeLabel}. Try another range or app filter.`}
          />
        )}
        <Pagination
          total={overviewData.eventsListTotal ?? 0}
          page={overviewData.eventsPage ?? eventsPage}
          pageSize={overviewData.listPageSize ?? listPageSize}
          hrefForPage={(p) =>
            mergeListQuery(OVERVIEW_PATH, currentOverviewParams, {
              eventsPage: String(p),
            })
          }
        />
      </DashboardSection>
    </>
  );
}
