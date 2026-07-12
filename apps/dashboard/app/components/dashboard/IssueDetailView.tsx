"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AnalyticsDetailLayout,
  AnalyticsMetricRow,
  AnalyticsPanel,
  AnalyticsSidebarPanel,
  IssueStatusBadge,
} from "@/app/components/dashboard/analytics-ui";
import { cn } from "@/lib/cn";

type TabId = "stack" | "occurrences";

const ISSUE_DETAIL_TABS = [
  { id: "stack" as const, label: "Stack trace" },
  { id: "occurrences" as const, label: "Occurrences" },
] as const;

export function IssueDetailView({
  issueId,
  title,
  resolved,
  badges,
  actions,
  metrics,
  sidebarTags,
  sidebarTimestamps,
  stackTrace,
  occurrences,
  defaultTab = "stack",
}: {
  issueId: string;
  title: string;
  resolved: boolean;
  badges: ReactNode;
  actions?: ReactNode;
  metrics: { label: string; value: ReactNode }[];
  sidebarTags: ReactNode;
  sidebarTimestamps: ReactNode;
  stackTrace: ReactNode;
  occurrences: ReactNode;
  defaultTab?: TabId;
}) {
  const [tab, setTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    setTab(defaultTab);
  }, [issueId, defaultTab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Issues / Error detail
          </p>
          <h1 className="mt-1 line-clamp-4 break-all text-lg font-semibold leading-snug tracking-tight text-destructive sm:line-clamp-3 sm:text-xl lg:text-2xl">
            {title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <IssueStatusBadge resolved={resolved} />
            {badges}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <AnalyticsPanel>
        <AnalyticsMetricRow items={metrics} />
      </AnalyticsPanel>

      <AnalyticsDetailLayout
        main={
          <AnalyticsPanel>
            <div
              className="flex gap-0 border-b border-border px-4 sm:px-5"
              role="tablist"
              aria-label="Issue detail sections"
            >
              {ISSUE_DETAIL_TABS.map((t) => {
                const selected = tab === t.id;
                const tabId = `issue-${issueId}-${t.id}-tab`;
                const panelId = `issue-${issueId}-${t.id}-panel`;

                return (
                  <button
                    key={t.id}
                    id={tabId}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "relative -mb-px border-b-2 px-3 py-3 text-[13px] transition-colors sm:px-4",
                      selected
                        ? "border-brand text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {ISSUE_DETAIL_TABS.map((t) => {
              const selected = tab === t.id;
              const tabId = `issue-${issueId}-${t.id}-tab`;
              const panelId = `issue-${issueId}-${t.id}-panel`;

              return (
                <div
                  key={t.id}
                  id={panelId}
                  className="p-4 sm:p-5"
                  role="tabpanel"
                  aria-labelledby={tabId}
                  hidden={!selected}
                  aria-hidden={!selected}
                >
                  {t.id === "stack" ? stackTrace : occurrences}
                </div>
              );
            })}
          </AnalyticsPanel>
        }
        sidebar={
          <>
            <AnalyticsSidebarPanel title="Tags">
              <div className="flex flex-wrap gap-2">{sidebarTags}</div>
            </AnalyticsSidebarPanel>
            <AnalyticsSidebarPanel title="Timeline">{sidebarTimestamps}</AnalyticsSidebarPanel>
          </>
        }
      />
    </div>
  );
}
