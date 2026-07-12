import { dashboardApiFetch } from "@/lib/dashboard-api";
import {
  DEFAULT_DASHBOARD_PREFERENCES,
  parseDashboardPreferences,
  type DashboardPreferences,
} from "@/lib/dashboard-preferences-shared";

export type {
  DashboardPreferences,
  DashboardTimeRangePreset,
} from "@/lib/dashboard-preferences-shared";

export {
  DEFAULT_DASHBOARD_PREFERENCES,
  dashboardPreferencesEqual,
  parseDashboardPreferences,
} from "@/lib/dashboard-preferences-shared";

export async function fetchDashboardPreferences(): Promise<DashboardPreferences> {
  const res = await dashboardApiFetch("/api/meta/dashboard-preferences");
  if (!res.ok) return DEFAULT_DASHBOARD_PREFERENCES;
  try {
    const data = (await res.json()) as { preferences?: unknown };
    return parseDashboardPreferences(data.preferences);
  } catch {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
}
