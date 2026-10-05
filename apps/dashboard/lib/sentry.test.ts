import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureClientException,
  dashboardServerHttpIntegrationOptions,
  getClientSentryDsn,
  getServerSentryDsn,
  isClientSentryEnabled,
  isServerSentryEnabled,
  replaceHttpIntegration,
  sentryInitOptions,
} from "./sentry";

describe("sentry env gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock("@/lib/product-telemetry");
  });

  it("returns undefined when DSN is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(getServerSentryDsn()).toBeUndefined();
    expect(getClientSentryDsn()).toBeUndefined();
    expect(isServerSentryEnabled()).toBe(false);
    expect(isClientSentryEnabled()).toBe(false);
  });

  it("trims DSN values outside test mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENTRY_DSN", "  https://example@sentry.io/1  ");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "  https://example@sentry.io/1  ");
    expect(getServerSentryDsn()).toBe("https://example@sentry.io/1");
    expect(getClientSentryDsn()).toBe("https://example@sentry.io/1");
  });

  it("skips all runtimes in test mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SENTRY_DSN", "https://example@sentry.io/1");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://example@sentry.io/1");
    expect(getServerSentryDsn()).toBeUndefined();
    expect(getClientSentryDsn()).toBeUndefined();
  });

  it("captureClientException is a no-op without client DSN", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(() => captureClientException(new Error("test"))).not.toThrow();
  });

  it("captureClientException tolerates window teardown during async product-telemetry import", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");

    const shouldTrack = vi.fn(() => {
      throw new Error("shouldTrackProductTelemetry must not run without window");
    });

    vi.resetModules();
    vi.doMock("@/lib/product-telemetry", async () => {
      await new Promise((r) => setTimeout(r, 25));
      return { shouldTrackProductTelemetry: shouldTrack };
    });

    const { captureClientException: capture } = await import("./sentry");
    expect(typeof window).not.toBe("undefined");
    expect(() => capture(new Error("teardown-race"))).not.toThrow();

    // Simulate jsdom teardown between sync return and dynamic-import resolution.
    vi.stubGlobal("window", undefined as unknown as Window & typeof globalThis);

    await new Promise((r) => setTimeout(r, 50));
    expect(shouldTrack).not.toHaveBeenCalled();
  });
});

describe("sentry privacy init options", () => {
  it("strips secrets in beforeSend and does not enable replay", () => {
    const options = sentryInitOptions("https://public@o1.ingest.de.sentry.io/1");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.includeLocalVariables).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");

    const event = {
      type: undefined,
      message: "boom",
      request: {
        method: "POST",
        url: "/v1/events?token=1",
        headers: { Authorization: "Bearer tt_live_secret" },
        data: "tt_live_secret",
      },
      user: { email: "person@example.com" },
    };
    const sent = options.beforeSend(event);
    expect(sent).toBe(event);
    expect(sent?.message).toBe("boom");
    expect(sent?.request?.url).toBe("/v1/events");
    expect(sent?.request?.data).toBeUndefined();
    expect(sent?.request?.headers).toEqual({});
    expect(sent?.user).toBeUndefined();
  });

  it("replaces only the Http integration and keeps incoming spans disabled", () => {
    const inbound = { name: "InboundFilters" };
    const http = { name: "Http" };
    const consoleIntegration = { name: "Console" };
    const replacement = { name: "Http", options: dashboardServerHttpIntegrationOptions };
    const replaced = replaceHttpIntegration(
      [inbound, http, consoleIntegration],
      replacement
    );

    expect(dashboardServerHttpIntegrationOptions).toEqual({
      disableIncomingRequestSpans: true,
      maxIncomingRequestBodySize: "none",
    });
    expect(replaced).toEqual([inbound, replacement, consoleIntegration]);
    expect(replaced[0]).toBe(inbound);
    expect(replaced[2]).toBe(consoleIntegration);
  });

  it("beforeSend survives a throwing getter and fails closed", () => {
    const options = sentryInitOptions("https://public@o1.ingest.de.sentry.io/1");
    const event: Record<string, unknown> = {
      type: undefined,
      message: "boom",
      exception: { values: [{ type: "Error", value: "kept" }] },
      user: { email: "person@example.com" },
      request: {
        method: "POST",
        url: "/v1/events?token=1",
        data: "tt_live_secret",
        cookies: "sid=1",
        query_string: "token=1",
      },
    };
    Object.defineProperty(event, "trap", {
      enumerable: true,
      get() {
        throw new Error("getter boom");
      },
    });
    expect(() => options.beforeSend(event as never)).not.toThrow();
    const sent = options.beforeSend(event as never);
    expect(sent).toBe(event);
    expect(sent).not.toBeNull();
    expect(sent?.message).toBe("boom");
    expect(sent?.user).toBeUndefined();
    expect((sent as { request?: { data?: unknown; url?: string } })?.request?.data).toBeUndefined();
    expect((sent as { request?: { url?: string } })?.request?.url).toBe("/v1/events");
  });
});
