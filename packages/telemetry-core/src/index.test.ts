import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildIngestHeaders,
  init,
  ingestError,
  shutdown,
  trackEvent,
  trackError,
  getConfigOrNull,
  getSessionId,
} from "./index.js";

describe("buildIngestHeaders", () => {
  it("includes Authorization when apiKey is set", () => {
    const h = buildIngestHeaders({ apiKey: "tt_live_abc_def" });
    expect(h.Authorization).toBe("Bearer tt_live_abc_def");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("omits Authorization when apiKey is missing", () => {
    const h = buildIngestHeaders({});
    expect(h.Authorization).toBeUndefined();
  });
});

describe("ingest fetch", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    init({
      ingestUrl: "http://localhost:3001",
      app: "test-app",
      apiKey: "tt_live_pub_secret",
      batchInterval: 0,
      environment: "test",
    });
  });

  afterEach(() => {
    shutdown();
    vi.unstubAllGlobals();
  });

  it("sends Authorization on trackEvent when batching disabled", async () => {
    trackEvent("test_event");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalled();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opts.headers).toMatchObject({
      Authorization: "Bearer tt_live_pub_secret",
    });
    expect(getConfigOrNull()?.apiKey).toBe("tt_live_pub_secret");
  });

  it("shutdown clears config and stops further ingest", () => {
    expect(getSessionId()).toBeTruthy();
    shutdown();
    expect(getConfigOrNull()).toBeNull();
    expect(getSessionId()).toBeNull();
    fetchMock.mockClear();
    trackEvent("after_shutdown");
    trackError(new Error("after_shutdown"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ingestError returns a Promise that settles after POST /ingest/error (core 1.5)", async () => {
    const pending = ingestError(new Error("fatal"), { source: "uncaughtException" });
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    const errorCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/ingest/error")
    );
    expect(errorCall).toBeTruthy();
    const [, opts] = errorCall as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toMatchObject({
      message: "fatal",
      context: { source: "uncaughtException" },
    });
  });
});
