"use client";

import Link from "next/link";
import { useDashboardNavigation } from "@/lib/use-dashboard-navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Footprints,
  FolderPlus,
  Key,
  LayoutDashboard,
  MousePointerClick,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { ORGANIZATION_SETTINGS_NEW_PROJECT_URL } from "@/app/components/OrganizationSettingsNewProjectParam";
import { searchInputClassName } from "@/lib/input-classes";
import { ShellKbd } from "./DashboardPopover";

type CommandItem = {
  id: string;
  label: string;
  href: string;
  group: string;
  keywords?: string[];
  icon: typeof LayoutDashboard;
};

const COMMANDS: CommandItem[] = [
  {
    id: "overview",
    label: "Overview",
    href: "/dashboard/overview",
    group: "Navigate",
    keywords: ["home", "dashboard"],
    icon: LayoutDashboard,
  },
  {
    id: "issues",
    label: "Issues",
    href: "/dashboard/errors",
    group: "Navigate",
    keywords: ["errors", "bugs"],
    icon: AlertTriangle,
  },
  {
    id: "events",
    label: "Events",
    href: "/dashboard/events",
    group: "Navigate",
    icon: MousePointerClick,
  },
  {
    id: "sessions",
    label: "Sessions",
    href: "/dashboard/sessions",
    group: "Navigate",
    icon: BarChart3,
  },
  {
    id: "visits",
    label: "Visits",
    href: "/dashboard/visits",
    group: "Navigate",
    keywords: ["sessions", "visitors", "screens", "country"],
    icon: Footprints,
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/dashboard/notifications",
    group: "Navigate",
    keywords: ["inbox", "bell", "alerts"],
    icon: Bell,
  },
  {
    id: "org",
    label: "Organization settings",
    href: "/dashboard/settings/organization",
    group: "Settings",
    keywords: ["workspace", "project"],
    icon: Settings,
  },
  {
    id: "team",
    label: "Team members",
    href: "/dashboard/settings/team",
    group: "Settings",
    keywords: ["invite"],
    icon: Users,
  },
  {
    id: "keys",
    label: "API keys",
    href: "/dashboard/settings/keys",
    group: "Settings",
    icon: Key,
  },
  {
    id: "create-project",
    label: "Create project",
    href: ORGANIZATION_SETTINGS_NEW_PROJECT_URL,
    group: "Actions",
    icon: FolderPlus,
  },
];

function matchCommand(item: CommandItem, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [item.label, item.group, ...(item.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(q);
}

export function DashboardCommandPalette() {
  const { push, isPending } = useDashboardNavigation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => COMMANDS.filter((item) => matchCommand(item, query.trim())),
    [query]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const run = useCallback(
    (href: string) => {
      close();
      push(href);
    },
    [close, push]
  );

  useEffect(() => {
    if (isPending && open) close();
  }, [close, isPending, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPending) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, isPending, open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault();
      run(filtered[activeIndex].href);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [filtered]);

  let flatIndex = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search dashboard"
        className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground sm:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search dashboard"
        className="hidden h-8 items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 text-[13px] text-muted-foreground hover:bg-surface hover:text-foreground sm:inline-flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <ShellKbd>⌘K</ShellKbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            aria-hidden
            onPointerDown={close}
          />
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/60"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search pages and actions…"
                autoComplete="off"
                className={`h-11 flex-1 ${searchInputClassName}`}
              />
              <ShellKbd>Esc</ShellKbd>
            </div>

            <div className="max-h-[min(50vh,360px)] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>
              ) : (
                Array.from(grouped.entries()).map(([group, items]) => (
                  <div key={group} className="mb-1 last:mb-0">
                    <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {group}
                    </div>
                    <ul className="list-none p-0">
                      {items.map((item) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        const Icon = item.icon;
                        const active = idx === activeIndex;
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm ${
                                active ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-surface/60 hover:text-foreground"
                              }`}
                              onMouseEnter={() => setActiveIndex(idx)}
                              onClick={() => run(item.href)}
                            >
                              <span className="grid h-7 w-7 place-items-center rounded-md border border-border bg-background">
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <span className="flex-1">{item.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span>Navigate with ↑↓ · Enter to open</span>
              <Link href="/dashboard/settings/shortcuts" onClick={close} className="hover:text-foreground">
                All shortcuts
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
