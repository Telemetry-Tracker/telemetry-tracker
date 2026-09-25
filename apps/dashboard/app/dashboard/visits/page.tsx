import { PageTitle } from "@/app/components/PageTitle";
import { redirect } from "next/navigation";
import { SessionsListToolbar } from "@/app/components/dashboard/SessionsListToolbar";
import { VisitsPanels, type VisitsSummary } from "@/app/components/dashboard/VisitsPanels";
import { AnalyticsListShell } from "@/app/components/dashboard/analytics-ui";
import { ErrorState } from "@/app/components/ErrorState";
import { redirectHrefIfMissingTimeRange, redirectHrefForMetricsUntil } from "@/lib/list-filters-url";
import {
  appendListTimeRangeToParams,
  isUnselectedTimeRange,
  parseListTimeRangeOrDefault,
  resolveMetricsUntilIso,
} from "@/lib/time-range";
import { firstQueryValue } from "@/lib/search-params";
import { dashboardApiFetch } from "@/lib/dashboard-api";

const VISITS_PATH = "/dashboard/visits";

async function getVisitsSummary(search: URLSearchParams): Promise<VisitsSummary> {
  const res = await dashboardApiFetch(`/api/visits/summary?${search.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<VisitsSummary>;
}

async function getFilterOptions(app?: string) {
  const p = new URLSearchParams();
  if (app) p.set("app", app);
  const res = await dashboardApiFetch(`/api/filter-options?${p.toString()}`);
  if (!res.ok) {
    return {
      environments: [] as string[],
      platforms: [] as string[],
      releases: [] as string[],
      countries: [] as string[],
    };
  }
  const data = (await res.json()) as {
    environments?: string[];
    platforms?: string[];
    releases?: string[];
    countries?: string[];
  };
  return {
    environments: data.environments ?? [],
    platforms: data.platforms ?? [],
    releases: data.releases ?? [],
    countries: data.countries ?? [],
  };
}

function buildParams(sp: Record<string, string | string[] | undefined>) {
  const keys = [
    "app",
    "range",
    "from",
    "to",
    "metricsUntil",
    "q",
    "environment",
    "release",
    "country",
    "platform",
  ] as const;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = firstQueryValue(sp[key]);
    if (value) out[key] = value;
  }
  return out;
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  let currentParams = buildParams(sp);
  const defaultTimeHref = redirectHrefIfMissingTimeRange(VISITS_PATH, currentParams);
  if (defaultTimeHref) redirect(defaultTimeHref);

  const appFilter = firstQueryValue(sp.app) ?? "";
  const from = firstQueryValue(sp.from) ?? "";
  const to = firstQueryValue(sp.to) ?? "";
  const timeRange = parseListTimeRangeOrDefault(
    {
      range: firstQueryValue(sp.range),
      from: from || undefined,
      to: to || undefined,
    },
    "all"
  );
  const pageAnchorIso = isUnselectedTimeRange(timeRange.key)
    ? resolveMetricsUntilIso(firstQueryValue(sp.metricsUntil))
    : null;
  const metricsUntilHref = redirectHrefForMetricsUntil(
    VISITS_PATH,
    currentParams,
    timeRange.key,
    pageAnchorIso
  );
  if (metricsUntilHref) redirect(metricsUntilHref);
  if (pageAnchorIso) {
    currentParams = { ...currentParams, metricsUntil: pageAnchorIso };
  } else if (currentParams.metricsUntil) {
    const { metricsUntil: _stale, ...rest } = currentParams;
    currentParams = rest;
  }

  const apiQuery = new URLSearchParams();
  if (appFilter) apiQuery.set("app", appFilter);
  appendListTimeRangeToParams(apiQuery, timeRange, from, to);
  const platform = firstQueryValue(sp.platform) ?? "";
  const environment = firstQueryValue(sp.environment) ?? "";
  const release = firstQueryValue(sp.release) ?? "";
  const country = firstQueryValue(sp.country) ?? "";
  const q = firstQueryValue(sp.q) ?? "";
  if (platform) apiQuery.set("platform", platform);
  if (environment) apiQuery.set("environment", environment);
  if (release) apiQuery.set("release", release);
  if (country) apiQuery.set("country", country);
  if (q) apiQuery.set("q", q);
  if (pageAnchorIso) apiQuery.set("metricsUntil", pageAnchorIso);

  let summary: VisitsSummary;
  let filterOptions: Awaited<ReturnType<typeof getFilterOptions>>;
  try {
    [summary, filterOptions] = await Promise.all([
      getVisitsSummary(apiQuery),
      getFilterOptions(appFilter || undefined),
    ]);
  } catch (error) {
    return (
      <>
        <PageTitle title="Visits" />
        <ErrorState message={error instanceof Error ? error.message : String(error)} />
      </>
    );
  }

  const sessionsHref = `/dashboard/sessions?${apiQuery.toString()}`;
  const sessionHref = (row: { id: string }) =>
    appFilter
      ? `/dashboard/sessions/${row.id}?app=${encodeURIComponent(appFilter)}`
      : `/dashboard/sessions/${row.id}`;

  return (
    <>
      <PageTitle
        title="Visits"
        context={
          appFilter
            ? `${timeRange.label} · App: ${appFilter}. One visit is one session.`
            : `${timeRange.label}. One visit is one session — duration, screens, device, and country.`
        }
      />
      <AnalyticsListShell>
        <SessionsListToolbar
          path={VISITS_PATH}
          currentParams={currentParams}
          timeRange={timeRange}
          fromParam={from}
          toParam={to}
          appFilter={appFilter}
          pageSize="50"
          defaultPageSize={50}
          q={q}
          environment={environment}
          release={release}
          country={country}
          platform={platform}
          sort="started_at"
          order="desc"
          hideSort
          environments={filterOptions.environments}
          releases={filterOptions.releases}
          countries={filterOptions.countries}
          platforms={filterOptions.platforms}
          onSortApply={() => undefined}
        />
        <VisitsPanels summary={summary} sessionsHref={sessionsHref} sessionHref={sessionHref} />
      </AnalyticsListShell>
    </>
  );
}
