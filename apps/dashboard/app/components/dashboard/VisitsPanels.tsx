import Link from "next/link";
import { AnalyticsPanel } from "@/app/components/dashboard/analytics-ui";
import { MetricCard, MetricCardGrid } from "@/app/components/dashboard/MetricCard";
import { SessionsTable, type SessionsTableRow } from "@/app/components/dashboard/SessionsTable";
import { countryFlagEmoji } from "@/lib/session-display";
import { formatDurationSec } from "@/lib/format-duration";
import { formatCompact } from "@/lib/overview-format";

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
  window: { since: string; until: string; label: string };
  visits: number;
  uniqueVisitors: number;
  avgDurationSec: number;
  medianDurationSec: number;
  pagesPerVisit: number;
  eventsPerVisit: number;
  singleScreenPct: number;
  countries: VisitBreakdownRow[];
  browsers: VisitBreakdownRow[];
  operatingSystems: VisitBreakdownRow[];
  platforms: VisitBreakdownRow[];
  topScreens: VisitScreenRow[];
  topActions: VisitActionRow[];
  recent: SessionsTableRow[];
};

function BreakdownList({
  title,
  description,
  rows,
  formatLabel,
}: {
  title: string;
  description: string;
  rows: VisitBreakdownRow[];
  formatLabel?: (label: string) => string;
}) {
  return (
    <AnalyticsPanel>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No visits in this range.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">
                {formatLabel ? formatLabel(row.label) : row.label}
              </span>
              <span className="tabular-nums">{row.count.toLocaleString()}</span>
              <span className="w-14 text-right tabular-nums text-muted-foreground">
                {row.sharePct}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </AnalyticsPanel>
  );
}

function countryLabel(label: string): string {
  if (label === "(not set)") return label;
  const flag = countryFlagEmoji(label);
  return flag ? `${flag} ${label.toUpperCase()}` : label.toUpperCase();
}

export function VisitsPanels({
  summary,
  sessionsHref,
  sessionHref,
}: {
  summary: VisitsSummary;
  sessionsHref: string;
  sessionHref: (row: SessionsTableRow) => string;
}) {
  return (
    <div className="space-y-4">
      <MetricCardGrid className="xl:grid-cols-4">
        <MetricCard
          label="Visits"
          value={formatCompact(summary.visits)}
          current={summary.visits}
          previous={null}
          accent="session"
          title="Sessions started in this range. One visit is one session."
        />
        <MetricCard
          label="Visitors"
          value={formatCompact(summary.uniqueVisitors)}
          current={summary.uniqueVisitors}
          previous={null}
          accent="neutral"
          title="Distinct user ids, or anonymous ids when the visitor is not identified."
        />
        <MetricCard
          label="Avg duration"
          value={formatDurationSec(summary.avgDurationSec)}
          current={summary.avgDurationSec}
          previous={null}
          accent="event"
          title="Average time from session start to end, or to the last event when the session is still open."
        />
        <MetricCard
          label="Median duration"
          value={formatDurationSec(summary.medianDurationSec)}
          current={summary.medianDurationSec}
          previous={null}
          title="Half of visits were shorter than this."
        />
      </MetricCardGrid>

      <div className="grid gap-3 sm:grid-cols-3">
        <AnalyticsPanel className="px-4 py-3.5">
          <p className="text-[12px] text-muted-foreground">Screens / visit</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.pagesPerVisit}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Distinct $screen, page_view, and screen_view names.
          </p>
        </AnalyticsPanel>
        <AnalyticsPanel className="px-4 py-3.5">
          <p className="text-[12px] text-muted-foreground">Actions / visit</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.eventsPerVisit}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">All events sent during the visit.</p>
        </AnalyticsPanel>
        <AnalyticsPanel className="px-4 py-3.5">
          <p className="text-[12px] text-muted-foreground">Single-screen visits</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.singleScreenPct}%</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Opened at most one screen, or none.
          </p>
        </AnalyticsPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankedNames
          title="Screens"
          description="Where people went. Names come from screen(), page_view, and screen_view."
          rows={summary.topScreens.map((row) => ({
            name: row.name,
            primary: `${row.views.toLocaleString()} views`,
            secondary: `${row.visits.toLocaleString()} visits`,
          }))}
        />
        <RankedNames
          title="Actions"
          description="Custom events sent during those visits. Automatic $ events are left out."
          rows={summary.topActions.map((row) => ({
            name: row.name,
            primary: `${row.count.toLocaleString()}`,
            secondary: `${row.visits.toLocaleString()} visits`,
          }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <BreakdownList
          title="Country"
          description="From the session country code."
          rows={summary.countries}
          formatLabel={countryLabel}
        />
        <BreakdownList
          title="Platform"
          description="SDK platform, such as web or ios."
          rows={summary.platforms}
        />
        <BreakdownList
          title="Browser"
          description="Parsed from the device on ingest."
          rows={summary.browsers}
        />
        <BreakdownList
          title="Operating system"
          description="Parsed from the device on ingest."
          rows={summary.operatingSystems}
        />
      </div>

      <AnalyticsPanel>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Latest visits</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Identity, device, duration, and screens for the most recent sessions.
            </p>
          </div>
          <Link href={sessionsHref} className="shrink-0 text-[13px] text-link hover:underline">
            All sessions
          </Link>
        </div>
        {summary.recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No visits in this range.</p>
        ) : (
          <SessionsTable
            rows={summary.recent}
            hrefForSession={sessionHref}
            hrefForView={sessionHref}
          />
        )}
      </AnalyticsPanel>
    </div>
  );
}

function RankedNames({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: { name: string; primary: string; secondary: string }[];
}) {
  return (
    <AnalyticsPanel>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing recorded in this range.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.name}
              className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{row.name}</span>
              <span className="tabular-nums">{row.primary}</span>
              <span className="hidden w-24 text-right text-[12px] text-muted-foreground sm:inline">
                {row.secondary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </AnalyticsPanel>
  );
}
