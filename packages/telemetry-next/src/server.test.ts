import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  clearReportedDigestsForTests,
  createOnRequestError,
  readServerError,
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

  it("keeps message and stack when instanceof Error fails across a realm", () => {
    const crossRealm = {
      message: "edge handler failed",
      stack: "Error: edge handler failed\n    at handler (.next/server/edge.js:1:10)",
      digest: "EDGE1",
      toString() {
        return "Error: edge handler failed";
      },
    };
    expect(crossRealm instanceof Error).toBe(false);
    expect(String(crossRealm)).toBe("Error: edge handler failed");

    const read = readServerError(crossRealm);
    expect(read.message).toBe("edge handler failed");
    expect(read.stack).toContain("edge.js");

    const payload = serverErrorPayload(crossRealm, request, context, {
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    expect(payload.message).toBe("edge handler failed");
    expect(payload.stack).toContain(".next/server/edge.js");
    expect(payload.context.digest).toBe("EDGE1");
    expect(payload.sdk_version).toBe("1.3.3");
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

  it("skips a second report of the same Error object", async () => {
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
  });

  it("skips a second report of the same frozen Error", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const err = Object.freeze(new Error("frozen"));
    await report(err, request, context);
    await report(err, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wasAlreadyReported(err)).toBe(true);
  });

  it("collapses a same-turn duplicate digest and reports the next occurrence", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const first = Object.assign(new Error("Profile query failed"), { digest: "2474318592" });
    const immediate = Object.assign(new Error("Profile query failed"), { digest: "2474318592" });

    const firstSend = report(first, request, context);
    const duplicateSend = report(immediate, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await Promise.all([firstSend, duplicateSend]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const again = Object.assign(new Error("Profile query failed"), { digest: "2474318592" });
    await report(again, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as [string, RequestInit])[1].body))
    );
    expect(bodies[0].message).toBe("Profile query failed");
    expect(bodies[1].message).toBe("Profile query failed");
    expect(bodies[0].context.digest).toBe("2474318592");
    expect(bodies[1].context.digest).toBe("2474318592");
  });

  it("reports route errors that have no digest, including two in the same turn", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const first = report(new Error("route a"), request, { ...context, routeType: "route" });
    const second = report(new Error("route b"), request, { ...context, routeType: "route" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
  });

  it("records two in-flight requests with the same digest after the turn ends", async () => {
    const pending: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const first = Object.assign(new Error("Profile query failed"), { digest: "2474318592" });
    const started = report(first, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The digest guard expires on a microtask, before the next HTTP request runs.
    await Promise.resolve();

    const second = Object.assign(new Error("Profile query failed"), { digest: "2474318592" });
    const startedAgain = report(second, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wasAlreadyReported(first)).toBe(true);
    expect(wasAlreadyReported(second)).toBe(true);

    for (const resolve of pending) resolve(new Response(null, { status: 204 }));
    await Promise.all([started, startedAgain]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports different digests in the same turn", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const render = Object.assign(new Error("render failed"), { digest: "111" });
    const action = Object.assign(new Error("action failed"), { digest: "222" });
    const firstSend = report(render, request, { ...context, routeType: "render" });
    const secondSend = report(action, request, { ...context, routeType: "action" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([firstSend, secondSend]);
    const digests = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call as [string, RequestInit])[1].body)).context.digest
    );
    expect(digests).toEqual(["111", "222"]);
  });

  it("sends the first sighting of a digest so ingest can open a new error group", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com",
      app: "web",
    });
    const err = Object.assign(new Error("new server failure"), {
      digest: "NEW1",
      stack: "Error: new server failure\n    at page (app/boom/page.tsx:4:13)",
    });
    await report(err, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.message).toBe("new server failure");
    expect(body.stack).toContain("app/boom/page.tsx");
    expect(body.context.digest).toBe("NEW1");
  });
});
