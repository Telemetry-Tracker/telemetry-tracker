export type DashboardTimeRangePreset = "1h" | "24h" | "7d" | "30d";

export type DashboardPreferences = {
  defaultTimeRange: DashboardTimeRangePreset;
  compactTableDensity: boolean;
  showResolvedIssues: boolean;
  usageAnalytics: boolean;
};

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  defaultTimeRange: "24h",
  compactTableDensity: false,
  showResolvedIssues: false,
  usageAnalytics: true,
};

export function parseDashboardPreferences(raw: unknown): DashboardPreferences {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
  const o = raw as Record<string, unknown>;
  const defaultTimeRange = o.defaultTimeRange;
  if (
    defaultTimeRange !== "1h" &&
    defaultTimeRange !== "24h" &&
    defaultTimeRange !== "7d" &&
    defaultTimeRange !== "30d"
  ) {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
  if (
    typeof o.compactTableDensity !== "boolean" ||
    typeof o.showResolvedIssues !== "boolean" ||
    typeof o.usageAnalytics !== "boolean"
  ) {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
  return {
    defaultTimeRange,
    compactTableDensity: o.compactTableDensity,
    showResolvedIssues: o.showResolvedIssues,
    usageAnalytics: o.usageAnalytics,
  };
}

export function dashboardPreferencesEqual(
  a: DashboardPreferences,
  b: DashboardPreferences
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
