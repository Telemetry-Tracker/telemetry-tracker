// @vitest-environment node
import { describe, expect, it } from "vitest";
import { crossAuthHref } from "@/lib/auth-href";

function makeParams(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("crossAuthHref with plan intent", () => {
  it("preserves plan=pro from register to login", () => {
    const href = crossAuthHref("/login", makeParams({ plan: "pro" }));
    expect(href).toBe("/login?plan=pro&next=%2Fdashboard%2Fsettings%2Fbilling%3Fplan%3Dpro");
  });

  it("preserves plan=business from register to login", () => {
    const href = crossAuthHref("/login", makeParams({ plan: "business" }));
    expect(href).toBe("/login?plan=business&next=%2Fdashboard%2Fsettings%2Fbilling%3Fplan%3Dbusiness");
  });

  it("preserves plan=pro from login to register", () => {
    const href = crossAuthHref("/register", makeParams({ plan: "pro" }));
    expect(href).toBe("/register?plan=pro");
  });

  it("ignores invalid plan values", () => {
    const href = crossAuthHref("/register", makeParams({ plan: "free" }));
    expect(href).toBe("/register");
  });

  it("preserves plan alongside ref and via", () => {
    const href = crossAuthHref(
      "/register",
      makeParams({ plan: "pro", ref: "alice", via: "email" })
    );
    expect(href).toContain("plan=pro");
    expect(href).toContain("ref=alice");
    expect(href).toContain("via=email");
  });

  it("preserves plan alongside invite", () => {
    const href = crossAuthHref(
      "/register",
      makeParams({ plan: "business", invite: "token123" })
    );
    expect(href).toContain("plan=business");
    expect(href).toContain("invite=token123");
  });

  it("explicit next overrides plan-based next on login", () => {
    const href = crossAuthHref(
      "/login",
      makeParams({ plan: "pro", next: "/dashboard/settings/organization" })
    );
    expect(href).toContain("next=%2Fdashboard%2Fsettings%2Forganization");
    expect(href).toContain("plan=pro");
  });

  it("no plan: login without plan gets no plan-based next", () => {
    const href = crossAuthHref("/login", makeParams({}));
    expect(href).toBe("/login");
  });
});
