import { describe, expect, it } from "vitest";
import { dashboardRangeCanonicalHref } from "./dashboard-range-redirect";

describe("dashboardRangeCanonicalHref", () => {
  it("adds the default range before list pages render", () => {
    expect(dashboardRangeCanonicalHref("/dashboard/overview", "")).toBe(
      "/dashboard/overview?range=24h"
    );
    expect(dashboardRangeCanonicalHref("/dashboard/errors", "?app=web")).toBe(
      "/dashboard/errors?app=web&range=24h"
    );
  });

  it("sends the dashboard root to overview before the page can redirect", () => {
    expect(dashboardRangeCanonicalHref("/dashboard", "")).toBe(
      "/dashboard/overview?range=24h"
    );
    expect(dashboardRangeCanonicalHref("/dashboard/", "")).toBe(
      "/dashboard/overview?range=24h"
    );
    expect(dashboardRangeCanonicalHref("/dashboard", "?range=24h")).toBe(
      "/dashboard/overview?range=24h"
    );
    expect(dashboardRangeCanonicalHref("/dashboard/", "?range=7d")).toBe(
      "/dashboard/overview?range=7d"
    );
    expect(dashboardRangeCanonicalHref("/dashboard", "?app=web")).toBe(
      "/dashboard/overview?app=web&range=24h"
    );
  });

  it("leaves explicit ranges and detail links alone", () => {
    expect(dashboardRangeCanonicalHref("/dashboard/overview", "?range=7d")).toBeNull();
    expect(dashboardRangeCanonicalHref("/dashboard/sessions", "?range=none")).toBeNull();
    expect(dashboardRangeCanonicalHref("/dashboard/errors", "?from=2026-01-01")).toBeNull();
    expect(
      dashboardRangeCanonicalHref("/dashboard/errors/11111111-1111-4111-8111-111111111111", "")
    ).toBeNull();
    expect(dashboardRangeCanonicalHref("/dashboard/settings/notifications", "")).toBeNull();
  });
});
