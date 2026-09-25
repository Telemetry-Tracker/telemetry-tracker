import { describe, expect, it, vi, afterEach } from "vitest";
import { createOnRequestError, serverErrorPayload } from "./server";

const request = { path: "/dashboard/settings", method: "POST" };
const context = {
  routerKind: "App Router" as const,
  routePath: "/dashboard/settings",
  routeType: "action" as const,
  renderSource: "react-server-components" as const,
};

describe("serverErrorPayload", () => {
  it("records the Next.js request error context without request headers", () => {
    const payload = serverErrorPayload(new Error("boom"), request, context, {
      ingestUrl: "https://api.example.com",
      app: "web",
      environment: "production",
      release: "1.2.3",
    });
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
  });
});

describe("createOnRequestError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the error to ingest and ignores a missing config", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = createOnRequestError({
      ingestUrl: "https://api.example.com/",
      apiKey: "tt_live_secret",
      app: "web",
    });
    await report(new Error("rsc failed"), request, {
      ...context,
      routeType: "render",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/ingest/error");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tt_live_secret",
    });
    const body = JSON.parse(String(init.body));
    expect(body.context.routeType).toBe("render");

    fetchMock.mockClear();
    await createOnRequestError({ ingestUrl: "", app: "web" })(
      new Error("skip"),
      request,
      context
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
