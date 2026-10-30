import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.cookie = "qa=; Max-Age=0; Path=/";
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.resetModules();
});

describe("qa-visit: reject then accept on the same page load", () => {
  it("keeps ?qa=1 seen at load in memory without storing it, and persists it only when consulted after consent", async () => {
    window.history.replaceState({}, "", "/?qa=1");
    vi.resetModules();
    const { isQaVisit, qaTrafficParams } = await import("./qa-visit");
    // Module load (pre-consent) stores nothing.
    expect(document.cookie).not.toMatch(/(^|; )qa=1/);
    expect(sessionStorage.getItem("tt-qa")).toBeNull();
    // Visitor rejected, navigated client-side (URL lost ?qa=1), then accepted.
    window.history.pushState({}, "", "/docs");
    expect(qaTrafficParams()).toEqual({ traffic_type: "internal" });
    expect(isQaVisit()).toBe(true);
    expect(document.cookie).toMatch(/(^|; )qa=1/);
    expect(sessionStorage.getItem("tt-qa")).toBe("1");
  });

  it("does not tag a visit that had no QA signal at load", async () => {
    window.history.replaceState({}, "", "/");
    vi.resetModules();
    const { qaTrafficParams } = await import("./qa-visit");
    window.history.pushState({}, "", "/docs");
    expect(qaTrafficParams()).toEqual({});
    expect(document.cookie).not.toMatch(/(^|; )qa=1/);
  });
});
