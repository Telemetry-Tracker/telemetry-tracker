"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Pin, Plus, Search } from "lucide-react";
import {
  buildDashboardHrefWithApp,
  dashboardPathForAppFilter,
} from "@/lib/dashboard-app-href";
import type { AppNavSummary } from "@/lib/app-nav-summary-types";
import {
  appNavSections,
  getAppPickerPrefs,
  recordRecentApp,
  togglePinnedApp,
} from "@/lib/app-picker-prefs";
import type { ProjectNavHealthStatus, ProjectNavSummary } from "@/lib/project-nav-summary-types";
import { resolveScopedQueryValue } from "@/lib/overview-scope-url";
import { searchInputClassName } from "@/lib/input-classes";
import { useDashboardNavigation } from "@/lib/use-dashboard-navigation";
import { cn } from "@/lib/utils";
import { DashboardPopover, ShellKbd } from "./DashboardPopover";
import { NavPickerSection } from "./NavPickerSection";
import { ProjectStatusDot } from "./ProjectStatusDot";
import { NavPickerLabel, NavPickerTrigger } from "./shell-primitives";

const IDLE_STATUS: ProjectNavHealthStatus = "idle";

const IDLE_APP_SUMMARY = (app: string): AppNavSummary => ({
  app,
  status: IDLE_STATUS,
  primaryEnvironment: null,
});

export function TopNavAppSwitcher({
  apps,
  projectId,
  appNavSummaries,
  projectNavSummaries,
}: {
  apps: string[];
  projectId: string;
  appNavSummaries: Record<string, AppNavSummary>;
  projectNavSummaries: Record<string, ProjectNavSummary>;
}) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const { push, replaceSilent, isPending } = useDashboardNavigation();
  const pathForLinks = dashboardPathForAppFilter(pathname);

  const rawApp = searchParams.get("app") ?? "";
  const appValue = resolveScopedQueryValue(rawApp, apps) ?? "";
  const displayApp = appValue || "All";

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(() => getAppPickerPrefs(projectId));
  const searchRef = useRef<HTMLInputElement>(null);

  const allAppsStatus: ProjectNavHealthStatus =
    projectNavSummaries[projectId]?.status ?? IDLE_STATUS;

  useEffect(() => {
    if (apps.length === 0) return;
    if (rawApp === "" || apps.includes(rawApp)) return;
    replaceSilent(buildDashboardHrefWithApp(pathForLinks, null, searchParams));
  }, [apps, pathForLinks, rawApp, replaceSilent, searchParams]);

  useEffect(() => {
    setPrefs(getAppPickerPrefs(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const sections = useMemo(
    () => appNavSections(apps, prefs, appValue, query),
    [appValue, apps, prefs, query]
  );

  const summaryFor = useCallback(
    (app: string): AppNavSummary => appNavSummaries[app] ?? IDLE_APP_SUMMARY(app),
    [appNavSummaries]
  );

  const triggerStatus = appValue ? summaryFor(appValue).status : allAppsStatus;

  const selectApp = useCallback(
    (nextApp: string | null, close: () => void) => {
      const normalized = nextApp ?? "";
      if (normalized === appValue) {
        close();
        return;
      }
      if (nextApp) {
        setPrefs({ ...prefs, recent: recordRecentApp(projectId, nextApp) });
      }
      push(buildDashboardHrefWithApp(pathForLinks, nextApp, searchParams));
      close();
    },
    [appValue, pathForLinks, prefs, projectId, push, searchParams]
  );

  const onTogglePin = useCallback(
    (event: React.MouseEvent, app: string) => {
      event.preventDefault();
      event.stopPropagation();
      const pinned = togglePinnedApp(projectId, app);
      setPrefs({ ...prefs, pinned });
    },
    [prefs, projectId]
  );

  const showAllAppsRow = !query.trim() || "all apps".includes(query.trim().toLowerCase());

  return (
    <DashboardPopover
      width="w-80"
      onOpenChange={setOpen}
      trigger={(toggle, isOpen) => (
        <NavPickerTrigger
          onClick={toggle}
          aria-expanded={isOpen}
          aria-label="App"
          aria-busy={isPending ? "true" : undefined}
          disabled={isPending}
          className={cn("max-w-[11rem]", isPending && "opacity-80")}
        >
          <ProjectStatusDot status={triggerStatus} />
          <NavPickerLabel>App</NavPickerLabel>
          <span className="truncate font-medium">{displayApp}</span>
          {isPending ? (
            <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </NavPickerTrigger>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps…"
              className={`w-full ${searchInputClassName}`}
            />
            <ShellKbd>/</ShellKbd>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {showAllAppsRow ? (
              <div className="px-1.5 pt-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface"
                  onClick={() => selectApp(null, close)}
                >
                  <ProjectStatusDot status={allAppsStatus} />
                  <span className="flex-1 text-left">All apps</span>
                  {appValue === "" ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              </div>
            ) : null}

            {sections.pinned.length > 0 ? (
              <NavPickerSection title="Pinned">
                {sections.pinned.map((app) => (
                  <AppPickerRow
                    key={`pinned-${app}`}
                    app={app}
                    active={appValue === app}
                    pinned
                    summary={summaryFor(app)}
                    onSelect={() => selectApp(app, close)}
                    onTogglePin={(e) => onTogglePin(e, app)}
                  />
                ))}
              </NavPickerSection>
            ) : null}

            {sections.recent.length > 0 ? (
              <NavPickerSection title="Recent">
                {sections.recent.map((app) => (
                  <AppPickerRow
                    key={`recent-${app}`}
                    app={app}
                    active={appValue === app}
                    pinned={prefs.pinned.includes(app)}
                    summary={summaryFor(app)}
                    onSelect={() => selectApp(app, close)}
                    onTogglePin={(e) => onTogglePin(e, app)}
                  />
                ))}
              </NavPickerSection>
            ) : null}

            {sections.all.length > 0 ? (
              <NavPickerSection title="All apps">
                {sections.all.map((app) => (
                  <AppPickerRow
                    key={`all-${app}`}
                    app={app}
                    active={appValue === app}
                    pinned={prefs.pinned.includes(app)}
                    summary={summaryFor(app)}
                    onSelect={() => selectApp(app, close)}
                    onTogglePin={(e) => onTogglePin(e, app)}
                  />
                ))}
              </NavPickerSection>
            ) : null}

            {apps.length === 0 ? (
              <p className="px-4 py-6 text-[12px] leading-relaxed text-muted-foreground">
                No applications yet. Connect one to this project — you do not need to wait for
                telemetry first.
              </p>
            ) : null}

            {apps.length > 0 &&
            !showAllAppsRow &&
            sections.pinned.length === 0 &&
            sections.recent.length === 0 &&
            sections.all.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No apps match.
              </p>
            ) : null}
          </div>

          <div className="border-t border-border p-1.5">
            <Link
              href="/dashboard/apps/connect"
              onClick={close}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Connect application
            </Link>
          </div>
        </div>
      )}
    </DashboardPopover>
  );
}

function AppPickerRow({
  app,
  active,
  pinned,
  summary,
  onSelect,
  onTogglePin,
}: {
  app: string;
  active: boolean;
  pinned: boolean;
  summary: AppNavSummary;
  onSelect: () => void;
  onTogglePin: (event: React.MouseEvent) => void;
}) {
  const envLabel = summary.primaryEnvironment;

  return (
    <div className="group flex items-center rounded-md pr-1 hover:bg-surface">
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
      >
        <ProjectStatusDot status={summary.status} />
        <span className="min-w-0 flex-1 truncate">{app}</span>
        {envLabel ? (
          <span className="hidden max-w-[5.5rem] truncate font-mono text-[10px] uppercase text-muted-foreground sm:inline">
            {envLabel}
          </span>
        ) : null}
        {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
      <button
        type="button"
        aria-label={pinned ? "Unpin app" : "Pin app"}
        title={pinned ? "Unpin" : "Pin"}
        onClick={onTogglePin}
        className={cn(
          "rounded p-1 text-muted-foreground hover:text-foreground",
          pinned ? "opacity-100 text-brand" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <Pin className={cn("h-3 w-3", pinned && "fill-current")} />
      </button>
    </div>
  );
}
