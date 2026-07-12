import { z } from "zod";

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

const timeRangePresetSchema = z.enum(["1h", "24h", "7d", "30d"]);

const preferencesSchema = z.object({
  defaultTimeRange: timeRangePresetSchema,
  compactTableDensity: z.boolean(),
  showResolvedIssues: z.boolean(),
  usageAnalytics: z.boolean(),
});

export function parseDashboardPreferences(raw: unknown): DashboardPreferences {
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return DEFAULT_DASHBOARD_PREFERENCES;
  }
  return parsed.data;
}

export function validateDashboardPreferencesPatch(
  body: unknown
): { ok: true; preferences: DashboardPreferences } | { ok: false; error: string } {
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Invalid dashboard preferences payload" };
  }
  return { ok: true, preferences: parsed.data };
}

export function dashboardPreferencesEqual(
  a: DashboardPreferences,
  b: DashboardPreferences
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
