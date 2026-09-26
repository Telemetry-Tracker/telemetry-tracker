import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_LOGIN_PATH,
  crossAuthHref,
  isPostLoginRedirectPath,
  normalizePostLoginRedirectPath,
  postLoginRedirectParts,
  resolvePostLoginPath,
} from "./auth-href";

describe("normalizePostLoginRedirectPath", () => {
  it("accepts legitimate relative paths and preserves query strings", () => {
    expect(normalizePostLoginRedirectPath("/dashboard/overview")).toBe(
      "/dashboard/overview"
    );
    expect(normalizePostLoginRedirectPath("/dashboard/errors?range=7d")).toBe(
      "/dashboard/errors?range=7d"
    );
    expect(
      normalizePostLoginRedirectPath("/dashboard/errors?range=7d&app=web")
    ).toBe("/dashboard/errors?range=7d&app=web");
  });

  it("rejects protocol-relative and absolute external URLs", () => {
    expect(normalizePostLoginRedirectPath("//evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("//example.invalid/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("https://evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("http://evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("//evil.example/x")).toBeNull();
  });

  it("rejects backslash-based open-redirect variants", () => {
    expect(normalizePostLoginRedirectPath("/\\evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/\\\\evil.example/x")).toBeNull();
  });

  it("rejects tab, CR, LF and other control-character smuggling", () => {
    expect(normalizePostLoginRedirectPath("/%09/evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/\tevil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/\revil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/\nevil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/%0d/evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/%0a/evil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/%0D%0A/evil.example/x")).toBeNull();
  });

  it("rejects encoded protocol-relative forms as seen in query params", () => {
    // URLSearchParams.get already once-decodes; these are the decoded shapes.
    expect(normalizePostLoginRedirectPath("//evil.example/x")).toBeNull();
    // Double-encoded forms that still start with / after one decode:
    expect(normalizePostLoginRedirectPath("%2F%2Fevil.example/x")).toBeNull();
    expect(normalizePostLoginRedirectPath("/%2F%2Fevil.example/x")).toBeNull();
  });

  it("rejects empty, homepage, and non-path values", () => {
    expect(normalizePostLoginRedirectPath(null)).toBeNull();
    expect(normalizePostLoginRedirectPath(undefined)).toBeNull();
    expect(normalizePostLoginRedirectPath("")).toBeNull();
    expect(normalizePostLoginRedirectPath("/")).toBeNull();
    expect(normalizePostLoginRedirectPath("dashboard/overview")).toBeNull();
    expect(normalizePostLoginRedirectPath("javascript:alert(1)")).toBeNull();
  });
});

describe("resolvePostLoginPath", () => {
  it("falls back to overview for unsafe next values", () => {
    const unsafe = [
      "//evil.example/x",
      "/\\evil.example/x",
      "/%09/evil.example/x",
      "%2F%2Fevil.example/x",
      "https://evil.example/x",
      "//example.invalid/x",
      "/\tevil.example/x",
      "/\revil.example/x",
      "/\nevil.example/x",
      "/%0d/evil.example/x",
      "/%0a/evil.example/x",
    ];
    for (const value of unsafe) {
      expect(resolvePostLoginPath(value)).toBe(DEFAULT_POST_LOGIN_PATH);
    }
  });

  it("preserves a valid path with query string exactly", () => {
    expect(resolvePostLoginPath("/dashboard/errors?range=7d")).toBe(
      "/dashboard/errors?range=7d"
    );
  });
});

describe("postLoginRedirectParts", () => {
  it("splits pathname and search so middleware does not encode ?", () => {
    expect(postLoginRedirectParts("/dashboard/errors?range=7d")).toEqual({
      pathname: "/dashboard/errors",
      search: "?range=7d",
    });
    expect(postLoginRedirectParts("//evil.example/x")).toEqual({
      pathname: DEFAULT_POST_LOGIN_PATH,
      search: "",
    });
    expect(postLoginRedirectParts("/dashboard/overview")).toEqual({
      pathname: "/dashboard/overview",
      search: "",
    });
  });
});

describe("isPostLoginRedirectPath", () => {
  it("mirrors normalize for legacy call sites", () => {
    expect(isPostLoginRedirectPath("/dashboard/errors?range=7d")).toBe(true);
    expect(isPostLoginRedirectPath("//evil.example/x")).toBe(false);
  });
});

describe("crossAuthHref", () => {
  it("forwards only safe next when switching to login", () => {
    expect(
      crossAuthHref("/login", {
        get: (key) => (key === "next" ? "/dashboard/errors?range=7d" : null),
      })
    ).toBe("/login?next=%2Fdashboard%2Ferrors%3Frange%3D7d");

    expect(
      crossAuthHref("/login", {
        get: (key) => (key === "next" ? "//evil.example/x" : null),
      })
    ).toBe("/login");
  });
});
