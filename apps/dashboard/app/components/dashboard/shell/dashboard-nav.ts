import {
  Activity,
  Bell,
  Flag,
  Gauge,
  LayoutDashboard,
  LayoutGrid,
  Package,
  LayoutList,
  Footprints,
  Radio,
  Search,
  Settings,
  Siren,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type DashboardNavItem = {
  href: string;
  label: string;
  enabled: boolean;
  comingSoon?: boolean;
};

export type DashboardNavIcon =
  | "overview"
  | "search"
  | "issues"
  | "events"
  | "sessions"
  | "visits"
  | "traces"
  | "logs"
  | "performance"
  | "releases"
  | "alerts"
  | "notifications"
  | "flags"
  | "dashboards"
  | "settings";

export type SidebarNavItem = DashboardNavItem & {
  icon: DashboardNavIcon;
};

export const DASHBOARD_NAV: SidebarNavItem[] = [
  { href: "/dashboard/overview", label: "Overview", enabled: true, icon: "overview" },
  { href: "/dashboard/errors", label: "Issues", enabled: true, icon: "issues" },
  { href: "/dashboard/events", label: "Events", enabled: true, icon: "events" },
  { href: "/dashboard/sessions", label: "Sessions", enabled: true, icon: "sessions" },
  { href: "/dashboard/visits", label: "Visits", enabled: true, icon: "visits" },
  { href: "/dashboard/performance", label: "Performance", enabled: true, icon: "performance" },
  { href: "/dashboard/releases", label: "Releases", enabled: true, icon: "releases" },
  { href: "/dashboard/alerts", label: "Alerts", enabled: true, icon: "alerts" },
  { href: "/dashboard/notifications", label: "Notifications", enabled: true, icon: "notifications" },
  { href: "/dashboard/search", label: "Search", enabled: true, icon: "search" },
  { href: "/dashboard/traces", label: "Traces", enabled: false, comingSoon: true, icon: "traces" },
  { href: "/dashboard/logs", label: "Logs", enabled: false, comingSoon: true, icon: "logs" },
  { href: "/dashboard/flags", label: "Flags", enabled: false, comingSoon: true, icon: "flags" },
  { href: "/dashboard/dashboards", label: "Dashboards", enabled: false, comingSoon: true, icon: "dashboards" },
];

export const SETTINGS_NAV: SidebarNavItem = {
  href: "/dashboard/settings/profile",
  label: "Settings",
  enabled: true,
  icon: "settings",
};

export const NAV_ICONS: Record<DashboardNavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  search: Search,
  issues: TriangleAlert,
  events: Zap,
  sessions: Radio,
  visits: Footprints,
  traces: Activity,
  logs: LayoutList,
  performance: Gauge,
  releases: Package,
  alerts: Siren,
  notifications: Bell,
  flags: Flag,
  dashboards: LayoutGrid,
  settings: Settings,
};

export function navLabelForPath(pathname: string): string | undefined {
  if (pathname.startsWith("/dashboard/settings")) return SETTINGS_NAV.label;
  const item = DASHBOARD_NAV.find(
    (n) => pathname === n.href || pathname.startsWith(`${n.href}/`)
  );
  return item?.label;
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard/settings/profile") {
    return pathname.startsWith("/dashboard/settings");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
