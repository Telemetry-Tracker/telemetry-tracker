// @vitest-environment node
/**
 * `?ref=` capture on every public landing path an affiliate is likely to link to.
 *
 * Capture is client-side (`ReferralCapture` in the ROOT layout reads `?ref=` / `?via=` on any
 * route). This suite verifies the server side does not get in the way: each destination is a real
 * page under the root layout, and middleware lets `?ref=` through (or carries it across the legacy
 * `?signUp=1` / `?signIn=1` redirects), while existing-account behaviour on /register is unchanged.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { AFFILIATE_DEEP_LINK_DESTINATIONS } from "@/lib/affiliate-program";

const appDir = join(import.meta.dirname, "..", "app");

/** Public landing paths that must capture `?ref=` (task acceptance list + verified deep links). */
const CAPTURE_PATHS = [
  "/",
  "/pricing",
  "/docs",
  "/docs/nextjs",
  "/docs/hosted-cloud",
  "/docs/migrate-from-sentry",
  "/sentry-alternative",
  "/self-hosted-error-tracking",
  "/error-tracking/nextjs",
  "/error-tracking/react",
  "/affiliates",
  "/register",
  ...AFFILIATE_DEEP_LINK_DESTINATIONS.map((d) => d.path),
];

function pageFileFor(path: string): string {
  return join(appDir, path === "/" ? "" : path.slice(1), "page.tsx");
}

function request(url: string, cookie?: string) {
  return new NextRequest(new URL(url, "https://telemetry-tracker.com"), {
    headers: cookie ? { cookie } : {},
  });
}

const SESSION = "telemetry_session=11111111-2222-4333-8444-555555555555";

function listLayouts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listLayouts(full));
    else if (entry === "layout.tsx") out.push(full);
  }
  return out;
}

describe("affiliate referral destinations", () => {
  it("root layout mounts ReferralCapture (so every App Router page captures ?ref=)", () => {
    const src = readFileSync(join(appDir, "layout.tsx"), "utf8");
    expect(src).toMatch(/import \{ ReferralCapture \}/);
    expect(src).toMatch(/<ReferralCapture \/>/);
    // No nested layout renders its own <html> (which would bypass the root layout).
    for (const layout of listLayouts(appDir).filter((p) => p !== join(appDir, "layout.tsx"))) {
      expect(readFileSync(layout, "utf8")).not.toMatch(/<html/);
    }
  });

  it.each([...new Set(CAPTURE_PATHS)])("%s is a real page and middleware passes ?ref= through", (path) => {
    expect(existsSync(pageFileFor(path))).toBe(true);
    const response = middleware(request(`${path}?ref=alice`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps ?ref= / ?via= across the legacy ?signUp=1 redirect to /register", () => {
    const response = middleware(request("/?signUp=1&ref=alice&utm_source=x"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/register");
    expect(location.searchParams.get("ref")).toBe("alice");
    expect(location.searchParams.get("utm_source")).toBeNull();

    const via = middleware(request("/pricing?signUp=1&via=bob&invite=tok"));
    const viaLocation = new URL(via.headers.get("location")!);
    expect(viaLocation.searchParams.get("via")).toBe("bob");
    expect(viaLocation.searchParams.get("invite")).toBe("tok");
  });

  it("keeps ?ref= on the legacy ?signIn=1 redirect without leaking it into next=", () => {
    const response = middleware(request("/docs/nextjs?signIn=1&ref=alice"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("ref")).toBe("alice");
    expect(location.searchParams.get("next")).toBe("/docs/nextjs");
  });

  it("plain legacy redirects without ?ref= are unchanged", () => {
    const response = middleware(request("/?signUp=1"));
    expect(response.headers.get("location")).toBe("https://telemetry-tracker.com/register");
  });

  it("www → apex redirect preserves ?ref=", () => {
    const req = new NextRequest(new URL("https://www.telemetry-tracker.com/pricing?ref=alice"), {
      headers: { host: "www.telemetry-tracker.com" },
    });
    const response = middleware(req);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://telemetry-tracker.com/pricing?ref=alice");
  });

  it("signed-in users on /register?ref= still go to the dashboard (existing accounts are never attributed)", () => {
    const response = middleware(request("/register?ref=alice", SESSION));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/overview");
    expect(location.search).toBe("");
  });
});
