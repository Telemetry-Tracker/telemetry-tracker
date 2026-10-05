import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const httpIntegration = vi.fn((options: unknown) => ({ name: "Http", options }));

describe("initSentryIfConfigured privacy wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    init.mockReset();
    httpIntegration.mockClear();
  });

  it("passes the sanitizer and keeps the privacy init flags", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://public@o1.ingest.de.sentry.io/1");
    vi.resetModules();
    vi.doMock("@sentry/node", () => ({
      init,
      httpIntegration,
      captureException: vi.fn(),
    }));

    const { initSentryIfConfigured } = await import("./observability.js");
    await initSentryIfConfigured();

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]?.[0] as {
      sendDefaultPii: boolean;
      includeLocalVariables: boolean;
      tracesSampleRate: number;
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
      integrations: (integrations: { name: string }[]) => { name: string }[];
    };
    expect(options.sendDefaultPii).toBe(false);
    expect(options.includeLocalVariables).toBe(false);
    expect(options.tracesSampleRate).toBe(0);

    const defaults = [{ name: "InboundFilters" }, { name: "Http" }, { name: "Console" }];
    const replaced = options.integrations(defaults);
    expect(httpIntegration).toHaveBeenCalledWith({ maxIncomingRequestBodySize: "none" });
    expect(replaced.map((integration) => integration.name)).toEqual([
      "InboundFilters",
      "Http",
      "Console",
    ]);
    expect(replaced[0]).toBe(defaults[0]);
    expect(replaced[2]).toBe(defaults[2]);
    expect(replaced[1]).not.toBe(defaults[1]);

    const event: Record<string, unknown> = {
      message: "boom",
      user: { email: "person@example.com" },
      request: {
        headers: { Authorization: "Bearer tt_live_secret" },
        data: "tt_live_secret",
      },
    };
    event.self = event;
    const sent = options.beforeSend(event);
    expect(sent).toBe(event);
    expect(sent.message).toBe("boom");
    expect(sent.user).toBeUndefined();
    const request = sent.request as { data?: unknown; headers: Record<string, unknown> };
    expect(request.data).toBeUndefined();
    expect(request.headers.Authorization).toBeUndefined();
  });

  it("beforeSend fails closed when the sanitizer walk throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://public@o1.ingest.de.sentry.io/1");
    vi.resetModules();
    vi.doMock("@sentry/node", () => ({
      init,
      httpIntegration,
      captureException: vi.fn(),
    }));

    const { initSentryIfConfigured } = await import("./observability.js");
    await initSentryIfConfigured();
    const options = init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };

    const event: Record<string, unknown> = {
      message: "kept",
      exception: { values: [{ type: "Error", value: "orig" }] },
      user: { email: "x@y.z" },
      request: { method: "POST", url: "/x?a=1", data: "body", cookies: "c=1", query_string: "a=1" },
    };
    Object.defineProperty(event, "trap", {
      enumerable: true,
      get() {
        throw new Error("getter boom");
      },
    });

    expect(() => options.beforeSend(event)).not.toThrow();
    const sent = options.beforeSend(event);
    expect(sent).toBe(event);
    expect(sent.message).toBe("kept");
    expect(sent.user).toBeUndefined();
    const request = sent.request as Record<string, unknown>;
    expect(request.data).toBeUndefined();
    expect(request.cookies).toBeUndefined();
    expect(request.query_string).toBeUndefined();
    expect(request.url).toBe("/x");
  });

});
