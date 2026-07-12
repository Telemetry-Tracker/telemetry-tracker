import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_PREFERENCES,
  parseDashboardPreferences,
  validateDashboardPreferencesPatch,
} from "./dashboard-preferences.js";

describe("dashboard-preferences", () => {
  it("returns defaults for invalid stored JSON", () => {
    expect(parseDashboardPreferences(null)).toEqual(DEFAULT_DASHBOARD_PREFERENCES);
    expect(parseDashboardPreferences({ defaultTimeRange: "bad" })).toEqual(
      DEFAULT_DASHBOARD_PREFERENCES
    );
  });

  it("parses valid stored preferences", () => {
    const prefs = {
      defaultTimeRange: "7d" as const,
      compactTableDensity: true,
      showResolvedIssues: true,
      usageAnalytics: false,
    };
    expect(parseDashboardPreferences(prefs)).toEqual(prefs);
  });

  it("validates PATCH payloads", () => {
    const valid = validateDashboardPreferencesPatch({
      defaultTimeRange: "1h",
      compactTableDensity: false,
      showResolvedIssues: false,
      usageAnalytics: true,
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.preferences.defaultTimeRange).toBe("1h");
    }

    const invalid = validateDashboardPreferencesPatch({ defaultTimeRange: "90d" });
    expect(invalid.ok).toBe(false);
  });
});
