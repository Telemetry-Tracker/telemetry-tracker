import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent, safeSanitizeSentryEvent } from "./sentry-privacy.js";

const SECRET = "tt_live_secret";

function textOf(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    return item;
  });
}

describe("sanitizeSentryEvent", () => {
  it("removes secrets and keeps the exception, stack, and path", () => {
    const event = {
      message: "boom",
      exception: {
        values: [
          {
            type: "TypeError",
            value: `handler failed near ${SECRET}`,
            stacktrace: {
              frames: [{ filename: "src/app.ts", function: "handler", lineno: 12 }],
            },
          },
        ],
      },
      request: {
        method: "POST",
        url: "https://telemetry-tracker.com/v1/events?token=abc",
        query_string: "token=abc",
        cookies: "sid=1",
        data: { key: SECRET },
        headers: {
          Authorization: `Bearer ${SECRET}`,
          authorization: "Bearer second",
          "X-Debug-Session": "sess-value",
          "USER-AGENT": "Mozilla/5.0",
          "Content-Type": "application/json",
          "X-Request-Id": "req-1",
          Cookie: "sid=1",
        },
      },
      user: { id: "user-1", email: "person@example.com" },
      extra: { note: "useful context" },
    };

    const sent = sanitizeSentryEvent(event);

    expect(sent).toBe(event);
    expect(sent.message).toBe("boom");
    expect(sent.exception.values[0]?.type).toBe("TypeError");
    expect(sent.exception.values[0]?.value).toBe("handler failed near [redacted]");
    expect(sent.exception.values[0]?.stacktrace.frames[0]).toEqual({
      filename: "src/app.ts",
      function: "handler",
      lineno: 12,
    });
    expect(sent.request.method).toBe("POST");
    expect(sent.request.url).toBe("https://telemetry-tracker.com/v1/events");
    expect(sent.request.headers["USER-AGENT"]).toBe("Mozilla/5.0");
    expect(sent.request.headers["Content-Type"]).toBe("application/json");
    expect(sent.request.headers["X-Request-Id"]).toBe("req-1");
    expect(sent.extra.note).toBe("useful context");
    expect(sent.user).toBeUndefined();
    expect(sent.request.data).toBeUndefined();
    expect(sent.request.cookies).toBeUndefined();
    expect(sent.request.query_string).toBeUndefined();
    expect(sent.request.headers.Authorization).toBeUndefined();
    expect(sent.request.headers.authorization).toBeUndefined();
    expect(sent.request.headers["X-Debug-Session"]).toBeUndefined();
    expect(sent.request.headers.Cookie).toBeUndefined();
    expect(textOf(sent)).not.toContain(SECRET);
    expect(textOf(sent)).not.toContain("person@example.com");
    expect(textOf(sent)).not.toContain("sess-value");
  });

  it("returns a directly circular event with secrets removed", () => {
    const event: Record<string, unknown> = {
      message: "boom",
      request: {
        method: "POST",
        url: "/v1/events?x=1",
        headers: { Cookie: "a=b", "Content-Type": "application/json" },
        data: SECRET,
      },
    };
    event.self = event;

    const sent = sanitizeSentryEvent(event);

    expect(sent).toBe(event);
    expect(event.message).toBe("boom");
    expect(event.self).toBe(event);
    const request = event.request as {
      data?: unknown;
      url?: string;
      headers: Record<string, string>;
    };
    expect(request.data).toBeUndefined();
    expect(request.url).toBe("/v1/events");
    expect(request.headers.Cookie).toBeUndefined();
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(textOf(sent)).not.toContain(SECRET);
  });

  it("returns a nested circular event with secrets removed", () => {
    const inner: Record<string, unknown> = {
      headers: { "X-Debug-Session": "sess-value", "Content-Type": "text/plain" },
    };
    const wrapper: Record<string, unknown> = {
      child: inner,
      method: "GET",
      url: "/nested?q=1",
      data: SECRET,
    };
    inner.up = wrapper;
    const event = { message: "boom", wrapper };

    const sent = sanitizeSentryEvent(event);

    expect(sent).toBe(event);
    expect(event.message).toBe("boom");
    expect(inner.up).toBe(wrapper);
    expect(wrapper.data).toBeUndefined();
    expect(wrapper.url).toBe("/nested");
    const headers = inner.headers as Record<string, string>;
    expect(headers["X-Debug-Session"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("text/plain");
    expect(textOf(sent)).not.toContain(SECRET);
    expect(textOf(sent)).not.toContain("sess-value");
  });

  it("sanitizes a shared reference once without treating it as a cycle", () => {
    const shared = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
        "USER-AGENT": "Mozilla/5.0",
      },
      method: "POST",
      url: "/v1/events?token=1",
    };
    const event = { message: "boom", left: shared, right: shared };

    const sent = sanitizeSentryEvent(event);

    expect(sent).toBe(event);
    expect(sent.left).toBe(sent.right);
    expect(sent.left.method).toBe("POST");
    expect(sent.left.url).toBe("/v1/events");
    expect(sent.left.headers["Content-Type"]).toBe("application/json");
    expect(sent.left.headers["USER-AGENT"]).toBe("Mozilla/5.0");
    expect(sent.left.headers.Authorization).toBeUndefined();
    expect(textOf(sent)).not.toContain(SECRET);
  });

  it("drops unscanned nested secrets when the depth budget is reached", () => {
    const event = {
      message: "boom",
      count: 1,
      deep: {
        headers: { Authorization: `Bearer ${SECRET}` },
        data: SECRET,
        cookies: "sid=1",
        user: { email: "hidden@example.com" },
        method: "POST",
      },
    };

    const sent = sanitizeSentryEvent(event, { maxDepth: 1 });

    expect(sent).toBe(event);
    expect(sent.message).toBe("boom");
    expect(sent.count).toBe(1);
    expect(sent.deep).toEqual({});
    expect(textOf(sent)).not.toContain(SECRET);
    expect(textOf(sent)).not.toContain("Authorization");
    expect(textOf(sent)).not.toContain("hidden@example.com");
    expect(textOf(sent)).not.toContain("sid=1");
  });

  it("drops unscanned nested secrets when the node budget is reached", () => {
    const event = {
      first: "visible",
      later: {
        headers: { Authorization: `Bearer ${SECRET}` },
        data: SECRET,
        user: { email: "hidden@example.com" },
        note: "tt_live_other",
      },
    };

    const sent = sanitizeSentryEvent(event, { maxNodes: 2 });

    expect(sent).toBe(event);
    expect(sent.first).toBe("visible");
    expect(sent.later).toBeUndefined();
    expect(textOf(sent)).not.toContain("tt_live_");
    expect(textOf(sent)).not.toContain("Authorization");
    expect(textOf(sent)).not.toContain("hidden@example.com");
  });

  it("safeSanitizeSentryEvent returns the event when a getter throws", () => {
    const event: Record<string, unknown> = {
      message: "keep-me",
      exception: {
        values: [{ type: "Error", value: "original failure", stacktrace: { frames: [{ filename: "a.ts", function: "f", lineno: 1 }] } }],
      },
      user: { email: "person@example.com" },
      request: {
        method: "POST",
        url: "/v1/events?token=1",
        data: SECRET,
        cookies: "sid=1",
        query_string: "token=1",
        headers: { "Content-Type": "application/json" },
      },
    };
    Object.defineProperty(event, "trap", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("getter boom");
      },
    });

    let threw = false;
    let sent: unknown;
    try {
      sent = safeSanitizeSentryEvent(event);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(sent).toBe(event);
    expect(sent).not.toBeNull();
    expect(event.message).toBe("keep-me");
    expect(event.user).toBeUndefined();
    const request = event.request as Record<string, unknown>;
    expect(request.data).toBeUndefined();
    expect(request.cookies).toBeUndefined();
    expect(request.query_string).toBeUndefined();
    expect(request.url).toBe("/v1/events");
    expect(request.method).toBe("POST");
    const exception = event.exception as { values: { type: string; value: string }[] };
    expect(exception.values[0]?.type).toBe("Error");
    expect(exception.values[0]?.value).toBe("original failure");
  });

  it("safeSanitizeSentryEvent returns the event when Proxy ownKeys throws", () => {
    const target: Record<string, unknown> = {
      message: "proxy-keep",
      exception: { values: [{ type: "TypeError", value: "proxy fail" }] },
      user: { id: "u1" },
      request: {
        method: "GET",
        url: "/path?q=1",
        data: SECRET,
        body: SECRET,
        cookies: { sid: "1" },
        query_string: { q: "1" },
      },
    };
    const event = new Proxy(target, {
      ownKeys() {
        throw new Error("ownKeys boom");
      },
      getOwnPropertyDescriptor(t, prop) {
        return Object.getOwnPropertyDescriptor(t, prop) ?? {
          enumerable: true,
          configurable: true,
          value: (t as Record<string | symbol, unknown>)[prop as string],
        };
      },
    });

    let threw = false;
    let sent: unknown;
    try {
      sent = safeSanitizeSentryEvent(event);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(sent).toBe(event);
    expect(sent).not.toBeNull();
    expect(target.message).toBe("proxy-keep");
    expect(target.user).toBeUndefined();
    const request = target.request as Record<string, unknown>;
    expect(request.data).toBeUndefined();
    expect(request.body).toBeUndefined();
    expect(request.cookies).toBeUndefined();
    expect(request.query_string).toBeUndefined();
    expect(request.url).toBe("/path");
    const exception = target.exception as { values: { type: string; value: string }[] };
    expect(exception.values[0]?.type).toBe("TypeError");
    expect(exception.values[0]?.value).toBe("proxy fail");
  });

});
