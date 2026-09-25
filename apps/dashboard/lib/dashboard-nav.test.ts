import { describe, expect, it } from "vitest";
import { isNavItemActive, navLabelForPath } from "@/app/components/dashboard/shell/dashboard-nav";

describe("dashboard sidebar nav", () => {
  it("marks nested issue routes active", () => {
    expect(isNavItemActive("/dashboard/errors", "/dashboard/errors")).toBe(true);
    expect(isNavItemActive("/dashboard/errors/abc", "/dashboard/errors")).toBe(true);
    expect(isNavItemActive("/dashboard/events", "/dashboard/errors")).toBe(false);
  });

  it("treats any settings path as Settings", () => {
    expect(isNavItemActive("/dashboard/settings/billing", "/dashboard/settings/profile")).toBe(
      true
    );
    expect(navLabelForPath("/dashboard/settings/team")).toBe("Settings");
  });

  it("labels the overview route", () => {
    expect(navLabelForPath("/dashboard/overview")).toBe("Overview");
  });

  it("labels the visits route", () => {
    expect(navLabelForPath("/dashboard/visits")).toBe("Visits");
    expect(isNavItemActive("/dashboard/visits", "/dashboard/sessions")).toBe(false);
  });
});
