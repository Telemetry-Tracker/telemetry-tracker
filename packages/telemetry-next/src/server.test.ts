import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  clearReportedDigestsForTests,
  createOnRequestError,
  safeRequestPath,
  serverErrorPayload,
  wasAlreadyReported,
} from "./server";

const request = { path: "/dashboard/settings", method: "POST" };
const context = {
  routerKind: "App Router" as const,
  routePath: "/dashboard/settings",
  routeType: "action" as const,
  renderSource: "react-server-components" as const,
};

describe("safeRequestPath", () => {
  it("strips query and hash", () => {
    expect(safeRequestPath("/api/x?token=secret#frag")).toBe("/api/x");
  });
});

describe("serverErrorPayload", () => {
  it("records request error context without request headers", () => {
    const payload = serverErrorPayload(
      new Error("boom"),
      {
        ...request,
        headers: { cookie: "session=abc", authorization: "Bearer leak" },
      },
      context,
      {
        ingestUrl: "https://api.example.com",
        app: "web",
        environment: "production",
        release: "1.2.3",
      }
    );
    expect(payload.app).toBe("web");
    expect(payload.message).toBe("boom");
    expect(payload.stack).toContain("boom");
    expect(payload.environment).toBe("production");
    expect(payload.release).toBe("1.2.3");
    expect(payload.context).toMatchObject({
      source: "next.onRequestError",
      routeType: "action",
      routePath: "/dashboard/settings",
      method: "POST",
      path: "/dashboard/settings",
    });
    expect(payload).not.toHaveProperty("headers");
    expect(JSON.stringify(payload)).not.toContain("session=abc");
    expect(JSON.stringify(payload)).not.toContain("Bearer leak");
  });

  it("strips query strings from the path and keeps digest when present", () => {
    const err = Object.assign(new Error("rsc"), { digest: "NEXT_DIGEST_1" });
    const payload = serverErrorPayload(
      err,
      { path: "/dashboard?token=secret", method: "GET" },
      { ...context, routeType: "render" },
      { ingestUrl: "https://api.example.com", app: "web" }
    );
    expect(payload.context.path).toBe("/dashboard");
    expect(payload.context.digest).toBe("NEXT_DIGEST_1");
  });

  it("labels nodejs vs edge from EdgeRuntime", () => {
    const nodePayload = serverErrorPayload(new Error("n"), request, context, {
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    expect(nodePayload.context.runtime).toBe("nodejs");

    vi.stubGlobal("EdgeRuntime", "edge");
    const edgePayload = serverErrorPayload(new Error("e"), request, context, {
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    expect(edgePayload.context.runtime).toBe("edge");
    vi.unstubAllGlobals();
  });
});

describe("createOnRequestError", () => {
  beforeEach(() => {
    clearReportedDigestsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearReportedDigestsForTests();
  });

  it("posts Server Component, Route Handler, and Server Action errors", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com/",
      apiKey: "tt_live_secret",
      app: "web",
    });

    for (const routeType of ["render", "route", "action"] as const) {
      fetchMock.mockClear();
      clearReportedDigestsForTests();
      await report(new Error(`${routeType} failed`), request, {
        ...context,
        routeType,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
      expect(body.context.routeType).toBe(routeType);
    }
  });

  it("posts on EdgeRuntime and skips empty config", async () => {
    vi.stubGlobal("EdgeRuntime", "edge");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    })(new Error("edge route"), request, { ...context, routeType: "route" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.context.runtime).toBe("edge");

    fetchMock.mockClear();
    await createOnRequestError({ ingestUrl: "", app: "web" })(
      new Error("skip"),
      request,
      context
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when ingest returns an error or fetch rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    await expect(report(new Error("a"), request, context)).resolves.toBeUndefined();
    clearReportedDigestsForTests();
    await expect(report(new Error("b"), request, context)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips duplicate reports for the same Error and the same digest", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const err = new Error("once");
    await report(err, request, context);
    await report(err, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wasAlreadyReported(err)).toBe(true);

    fetchMock.mockClear();
    const first = Object.assign(new Error("digest"), { digest: "D1" });
    const second = Object.assign(new Error("digest again"), { digest: "D1" });
    await report(first, request, context);
    await report(second, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
