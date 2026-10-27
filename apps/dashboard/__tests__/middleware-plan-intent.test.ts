// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function request(url: string, cookie?: string) {
  return new NextRequest(new URL(url, "https://telemetry-tracker.com"), {
    headers: cookie ? { cookie } : {},
  });
}

const SESSION = "telemetry_session=11111111-2222-4333-8444-555555555555";

describe("middleware plan intent preservation", () => {
  it("signed-in user on /register?plan=pro redirects to billing with plan", () => {
    const response = middleware(request("/register?plan=pro", SESSION));
    const location = response.headers.get("location");
    expect(location).toBe("https://telemetry-tracker.com/dashboard/settings/billing?plan=pro");
  });

  it("signed-in user on /register?plan=business redirects to billing with plan", () => {
    const response = middleware(request("/register?plan=business", SESSION));
    const location = response.headers.get("location");
    expect(location).toBe("https://telemetry-tracker.com/dashboard/settings/billing?plan=business");
  });

  it("signed-in user on /register without plan redirects to overview", () => {
    const response = middleware(request("/register", SESSION));
    const location = response.headers.get("location");
    expect(location).toBe("https://telemetry-tracker.com/dashboard/overview");
  });

  it("signed-in user on /register?plan=free redirects to overview (invalid plan)", () => {
    const response = middleware(request("/register?plan=free", SESSION));
    const location = response.headers.get("location");
    expect(location).toBe("https://telemetry-tracker.com/dashboard/overview");
  });

  it("signed-in user on /register?invite=... still goes through (invite wins)", () => {
    const response = middleware(request("/register?invite=token123&plan=pro", SESSION));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("legacy ?signUp=1&plan=pro redirect preserves plan on /register", () => {
    const response = middleware(request("/?signUp=1&plan=pro"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/register");
    expect(location.searchParams.get("plan")).toBe("pro");
  });

  it("legacy ?signUp=1&plan=business redirect preserves plan on /register", () => {
    const response = middleware(request("/pricing?signUp=1&plan=business"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/register");
    expect(location.searchParams.get("plan")).toBe("business");
  });

  it("legacy ?signUp=1&plan=free ignores invalid plan", () => {
    const response = middleware(request("/?signUp=1&plan=free"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/register");
    expect(location.searchParams.get("plan")).toBeNull();
  });

  it("legacy ?signUp=1 preserves plan alongside ref", () => {
    const response = middleware(request("/?signUp=1&plan=pro&ref=alice"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("plan")).toBe("pro");
    expect(location.searchParams.get("ref")).toBe("alice");
  });

  it("logged-out /register?plan=pro is not redirected", () => {
    const response = middleware(request("/register?plan=pro"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
