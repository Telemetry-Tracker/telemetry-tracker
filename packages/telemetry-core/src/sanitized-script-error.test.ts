import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSanitizedScriptErrorContext,
  clearSanitizedGlobalErrorDedupe,
  createSanitizedGlobalErrorDedupeStore,
  isSanitizedBrowserScriptError,
  sanitizedGlobalErrorDedupeKey,
  shouldReportSanitizedGlobalError,
} from "./sanitized-script-error.js";

describe("isSanitizedBrowserScriptError", () => {
  it("detects classic sanitized Script error. (empty location, no Error)", () => {
    expect(
      isSanitizedBrowserScriptError("Script error.", "", 0, 0, undefined)
    ).toBe(true);
    expect(isSanitizedBrowserScriptError("Script error", "", 0, 0)).toBe(true);
  });

  it("rejects Script error. when a real Error object is present", () => {
    expect(
      isSanitizedBrowserScriptError(
        "Script error.",
        "",
        0,
        0,
        new Error("Script error.")
      )
    ).toBe(false);
  });

  it("rejects when filename/line/col indicate a real location", () => {
    expect(
      isSanitizedBrowserScriptError(
        "Script error.",
        "https://app.example/app.js",
        12,
        4
      )
    ).toBe(false);
    expect(isSanitizedBrowserScriptError("Script error.", "", 10, 0)).toBe(
      false
    );
  });

  it("rejects unrelated messages", () => {
    expect(isSanitizedBrowserScriptError("TypeError: x", "", 0, 0)).toBe(
      false
    );
    expect(isSanitizedBrowserScriptError(new Event("error"), "", 0, 0)).toBe(
      false
    );
  });
});

describe("shouldReportSanitizedGlobalError", () => {
  it("allows the first report and suppresses identical ones in the window", () => {
    const store = createSanitizedGlobalErrorDedupeStore();
    const key = sanitizedGlobalErrorDedupeKey("Script error.", "", 0, 0);
    const t0 = 1_000_000;
    const windowMs = 60_000;

    expect(shouldReportSanitizedGlobalError(store, key, t0, windowMs, 1)).toBe(
      true
    );
    // 212 identical fires inside the same window (Besedolov-style flood) → only first reports
    let allowed = 0;
    for (let i = 1; i < 212; i++) {
      if (
        shouldReportSanitizedGlobalError(
          store,
          key,
          t0 + i * 50, // stay well inside the 60s window
          windowMs,
          1
        )
      ) {
        allowed += 1;
      }
    }
    expect(allowed).toBe(0);
  });

  it("allows reporting again after the dedupe window expires", () => {
    const store = createSanitizedGlobalErrorDedupeStore();
    const key = sanitizedGlobalErrorDedupeKey("Script error.", "", 0, 0);
    const windowMs = 60_000;
    const t0 = 5_000_000;

    expect(shouldReportSanitizedGlobalError(store, key, t0, windowMs, 1)).toBe(
      true
    );
    expect(
      shouldReportSanitizedGlobalError(store, key, t0 + windowMs - 1, windowMs, 1)
    ).toBe(false);
    expect(
      shouldReportSanitizedGlobalError(store, key, t0 + windowMs, windowMs, 1)
    ).toBe(true);
  });

  it("treats different keys independently", () => {
    const store = createSanitizedGlobalErrorDedupeStore();
    const a = sanitizedGlobalErrorDedupeKey("Script error.", "", 0, 0);
    // Not classic sanitized, but still a distinct key for the store
    const b = sanitizedGlobalErrorDedupeKey("Script error.", "x.js", 1, 2);
    const t0 = 9_000_000;

    expect(shouldReportSanitizedGlobalError(store, a, t0, 60_000, 1)).toBe(
      true
    );
    expect(shouldReportSanitizedGlobalError(store, b, t0, 60_000, 1)).toBe(
      true
    );
    expect(shouldReportSanitizedGlobalError(store, a, t0 + 10, 60_000, 1)).toBe(
      false
    );
  });

  it("respects maxPerWindow > 1", () => {
    const store = createSanitizedGlobalErrorDedupeStore();
    const key = sanitizedGlobalErrorDedupeKey("Script error.", "", 0, 0);
    const t0 = 1000;
    expect(shouldReportSanitizedGlobalError(store, key, t0, 60_000, 2)).toBe(
      true
    );
    expect(shouldReportSanitizedGlobalError(store, key, t0 + 1, 60_000, 2)).toBe(
      true
    );
    expect(shouldReportSanitizedGlobalError(store, key, t0 + 2, 60_000, 2)).toBe(
      false
    );
  });

  it("clears state on reset", () => {
    const store = createSanitizedGlobalErrorDedupeStore();
    const key = sanitizedGlobalErrorDedupeKey("Script error.", "", 0, 0);
    const t0 = 1000;
    expect(shouldReportSanitizedGlobalError(store, key, t0, 60_000, 1)).toBe(
      true
    );
    clearSanitizedGlobalErrorDedupe(store);
    expect(shouldReportSanitizedGlobalError(store, key, t0 + 1, 60_000, 1)).toBe(
      true
    );
  });
});

describe("buildSanitizedScriptErrorContext", () => {
  it("preserves onerror metadata and marks the payload sanitized", () => {
    expect(buildSanitizedScriptErrorContext("", 0, 0)).toEqual({
      source: "window.onerror",
      filename: "",
      lineno: 0,
      colno: 0,
      sanitized: true,
      browser_error: "sanitized_script_error",
    });
  });
});

describe("window.onerror sanitized Script error integration", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  let onerrorHandler:
    | ((
        message: string | Event,
        source?: string,
        lineno?: number,
        colno?: number,
        error?: Error
      ) => boolean)
    | null = null;
  const listeners = new Map<string, Set<EventListener>>();

  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockClear();
    onerrorHandler = null;
    listeners.clear();

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    vi.stubGlobal("document", {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener(type: string, listener: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
    });
    const windowStub: {
      addEventListener: (type: string, listener: EventListener) => void;
      onerror:
        | ((
            message: string | Event,
            source?: string,
            lineno?: number,
            colno?: number,
            error?: Error
          ) => boolean)
        | null;
    } = {
      addEventListener(type: string, listener: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      onerror: null,
    };
    Object.defineProperty(windowStub, "onerror", {
      configurable: true,
      get() {
        return onerrorHandler;
      },
      set(fn) {
        onerrorHandler = fn;
      },
    });
    vi.stubGlobal("window", windowStub);
    vi.stubGlobal("setInterval", () => 0 as unknown as ReturnType<typeof setInterval>);

    const { init } = await import("./index.js");
    init({
      ingestUrl: "http://localhost:3001",
      app: "test-app",
      apiKey: "tt_live_pub_secret",
      batchInterval: 0,
      environment: "test",
      webVitals: false,
    });
  });

  afterEach(async () => {
    const { shutdown } = await import("./index.js");
    shutdown();
    vi.unstubAllGlobals();
  });

  async function flushMicrotasks(): Promise<void> {
    await new Promise((r) => setTimeout(r, 10));
  }

  function errorBodies(): Array<{
    message?: string;
    stack?: string;
    context?: Record<string, unknown>;
  }> {
    return fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/ingest/error"))
      .map(([, opts]) => JSON.parse(String((opts as RequestInit).body)));
  }

  it("reports sanitized Script error. once without a fabricated stack (212-fire scenario)", async () => {
    expect(onerrorHandler).toBeTypeOf("function");

    for (let i = 0; i < 212; i++) {
      onerrorHandler!("Script error.", "", 0, 0, undefined);
    }
    await flushMicrotasks();

    const bodies = errorBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.message).toBe("Script error.");
    expect(bodies[0]?.stack).toBeUndefined();
    expect(bodies[0]?.context).toMatchObject({
      source: "window.onerror",
      filename: "",
      lineno: 0,
      colno: 0,
      sanitized: true,
      browser_error: "sanitized_script_error",
    });
    // Must not invent an Error stack pointing into the SDK handler
    expect(bodies[0]?.stack ?? "").not.toMatch(/at /);
  });

  it("still reports legitimate repeated errors with real Error objects", async () => {
    for (let i = 0; i < 5; i++) {
      onerrorHandler!(
        "TypeError: boom",
        "https://app.example/app.js",
        10,
        4,
        new Error("TypeError: boom")
      );
    }
    await flushMicrotasks();

    const bodies = errorBodies();
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect(body.message).toBe("TypeError: boom");
      expect(body.stack).toBeTruthy();
      expect(body.context).toMatchObject({
        source: "window.onerror",
        filename: "https://app.example/app.js",
        lineno: 10,
        colno: 4,
      });
      expect(body.context?.sanitized).toBeUndefined();
    }
  });

  it("does not treat Script error. with a real Error object as sanitized", async () => {
    const err = new Error("Script error.");
    onerrorHandler!("Script error.", "", 0, 0, err);
    onerrorHandler!("Script error.", "", 0, 0, err); // same instance → instance dedupe
    await flushMicrotasks();

    const bodies = errorBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.stack).toBeTruthy();
    expect(bodies[0]?.context?.sanitized).toBeUndefined();
  });

  it("does not change unhandledrejection behavior", async () => {
    const rejectionListeners = listeners.get("unhandledrejection");
    expect(rejectionListeners?.size).toBeGreaterThan(0);
    const reason = new Error("promise failed");
    for (const listener of rejectionListeners!) {
      listener({ reason } as PromiseRejectionEvent);
    }
    await flushMicrotasks();

    const bodies = errorBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.message).toBe("promise failed");
    expect(bodies[0]?.context).toEqual({ source: "unhandledrejection" });
  });

  it("re-allows sanitized Script error. after shutdown/init (dedupe reset)", async () => {
    onerrorHandler!("Script error.", "", 0, 0, undefined);
    await flushMicrotasks();
    expect(errorBodies()).toHaveLength(1);

    const { shutdown, init } = await import("./index.js");
    shutdown();
    fetchMock.mockClear();

    // Handlers stay installed (by design) but no-op without config; re-init
    init({
      ingestUrl: "http://localhost:3001",
      app: "test-app",
      apiKey: "tt_live_pub_secret",
      batchInterval: 0,
      environment: "test",
      webVitals: false,
    });

    onerrorHandler!("Script error.", "", 0, 0, undefined);
    await flushMicrotasks();
    expect(errorBodies()).toHaveLength(1);
  });

  it("swallows reporting failures without recursive onerror storms", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error("ingest blew up");
    });
    // If reporting re-entered onerror recursively, this would stack-overflow.
    expect(() => {
      for (let i = 0; i < 20; i++) {
        onerrorHandler!("Script error.", "", 0, 0, undefined);
      }
    }).not.toThrow();
  });
});
