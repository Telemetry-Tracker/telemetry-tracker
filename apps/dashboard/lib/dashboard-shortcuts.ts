export type DashboardShortcut = {
  group: string;
  keys: string[];
  label: string;
  href?: string;
};

export const DASHBOARD_SHORTCUTS: DashboardShortcut[] = [
  { group: "Navigation", keys: ["G", "O"], label: "Go to Overview", href: "/dashboard/overview" },
  { group: "Navigation", keys: ["G", "I"], label: "Go to Issues", href: "/dashboard/errors" },
  { group: "Navigation", keys: ["G", "E"], label: "Go to Events", href: "/dashboard/events" },
  { group: "Navigation", keys: ["G", "S"], label: "Go to Sessions", href: "/dashboard/sessions" },
  { group: "Navigation", keys: ["G", "V"], label: "Go to Visits", href: "/dashboard/visits" },
  { group: "General", keys: ["⌘", "K"], label: "Open command palette" },
  { group: "General", keys: ["?"], label: "Show keyboard shortcuts" },
  { group: "General", keys: ["Esc"], label: "Close dialogs" },
];

export const DASHBOARD_GOTO_MAP: Record<string, string> = {
  o: "/dashboard/overview",
  i: "/dashboard/errors",
  e: "/dashboard/events",
  s: "/dashboard/sessions",
  v: "/dashboard/visits",
};
