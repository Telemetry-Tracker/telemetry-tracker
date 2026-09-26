import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shutdown as coreShutdown } from "@telemetry-tracker/core";
import {
  createUncaughtExceptionHandler,
  createUnhandledRejectionHandler,
  init,
  middleware,
} from "./index.js";

describe("createUncaughtExceptionHandler", () => {
  it("flushes with source uncaughtException then exits", async () => {
    const order: string[] = [];
    let resolveIngest!: () => void;
    const ingest = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveIngest = () => {
            order.push("ingest");
            resolve();
          };
        })
    );
    const exit = vi.fn((code: number) => {
      order.push(`exit:${code}`);
    });

    createUncaughtExceptionHandler({ ingest, exit })(new Error("boom"));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    expect(ingest).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: "uncaughtException" })
    );
    resolveIngest();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["ingest", "exit:1"]);
  });

  it.each([null, undefined, "x", 7, { e: true }])(
    "ingests non-Error throw %j then exits 1",
    async (thrown) => {
      const ingest = vi.fn(async () => {});
      const exit = vi.fn();
      createUncaughtExceptionHandler({ ingest, exit, timeoutMs: 50 })(thrown);
      await new Promise((r) => setTimeout(r, 20));
      expect(ingest).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ source: "uncaughtException" })
      );
      await new Promise((r) => setTimeout(r, 40));
      expect(exit).toHaveBeenCalledWith(1);
    }
  );
});

describe("createUnhandledRejectionHandler", () => {
  it("flushes and exits by default (TT-019)", async () => {
    const order: string[] = [];
    let resolveIngest!: () => void;
    const ingest = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveIngest = () => {
            order.push("ingest");
            resolve();
          };
        })
    );
    const trackError = vi.fn();
    const exit = vi.fn((code: number) => {
      order.push(`exit:${code}`);
    });

    createUnhandledRejectionHandler({
      exitOnUnhandledRejection: true,
      ingest,
      trackError,
      exit,
    })(new Error("rejected"));

    expect(trackError).not.toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: "unhandledRejection" })
    );
    resolveIngest();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["ingest", "exit:1"]);
  });

  it("only reports when exitOnUnhandledRejection is false", async () => {
    const ingest = vi.fn(async () => {});
    const trackError = vi.fn();
    const exit = vi.fn();

    createUnhandledRejectionHandler({
      exitOnUnhandledRejection: false,
      ingest,
      trackError,
      exit,
    })("string-reason");

    expect(ingest).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(trackError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "string-reason" }),
      { source: "unhandledRejection" }
    );
  });
});

describe("middleware", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    init({
      ingestUrl: "http://localhost:4318",
      app: "qa-node",
      apiKey: "test",
      batchInterval: 0,
      environment: "test",
    });
  });

  afterEach(() => {
    coreShutdown();
    vi.unstubAllGlobals();
  });


  async function waitForRequestEvents(): Promise<
    Array<{ name?: string; properties?: Record<string, unknown> }>
  > {
    await new Promise((r) => setTimeout(r, 30));
    return fetchMock.mock.calls
      .filter((call) => String(call[0]).includes("/ingest/event"))
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
  }

  it("calls next exactly once when req has no on (TT-020 / #632)", async () => {
    let nextCount = 0;
    const res = new EventEmitter();
    middleware()({ method: "GET", url: "/x" }, res, () => {
      nextCount += 1;
    });
    expect(nextCount).toBe(1);
    res.emit("finish");
    const events = await waitForRequestEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "$request",
          properties: expect.objectContaining({ method: "GET", url: "/x" }),
        }),
      ])
    );
  });

  it("calls next exactly once for plain-object res without emitters", async () => {
    let nextCount = 0;
    middleware()({ method: "GET", url: "/plain" }, {}, () => {
      nextCount += 1;
    });
    expect(nextCount).toBe(1);
    const events = await waitForRequestEvents();
    expect(events.some((e) => e.name === "$request")).toBe(true);
  });

  it("records duration_ms until response finish, not request end (TT-020)", async () => {
    const res = new EventEmitter();
    // Simulate a body parser that already ended the request stream before the handler.
    const req = Object.assign(new EventEmitter(), {
      method: "POST",
      url: "/slow",
      body: { a: 1 },
    });
    middleware()(req, res, () => {});
    req.emit("end");
    await new Promise((r) => setTimeout(r, 80));
    res.emit("finish");

    const events = await waitForRequestEvents();
    const request = events.find((e) => e.name === "$request");
    expect(request).toBeTruthy();
    const duration = Number(request!.properties!.duration_ms);
    expect(duration).toBeGreaterThanOrEqual(70);
    expect(duration).toBeLessThan(500);
  });
});
