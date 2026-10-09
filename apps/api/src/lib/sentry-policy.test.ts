import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeClient, defaultStackParser } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { sentryPrivacyOptions } from "./sentry-policy.js";
import { safeSanitizeSentryEvent, sanitizeSentryBreadcrumb } from "./sentry-privacy.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

describe("operator Sentry SDK upgrade guard", () => {
  it("requires a privacy review when either installed SDK changes major", () => {
    const api = require("@sentry/node/package.json") as { version: string };
    const dashboardRequire = createRequire(resolve(here, "../../../dashboard/package.json"));
    const dashboard = dashboardRequire("@sentry/nextjs/package.json") as { version: string };
    expect(api.version.split(".")[0], "Review Sentry collection options and transport on major upgrades").toBe("10");
    expect(dashboard.version.split(".")[0]).toBe("10");
  });

  it("keeps the browser-safe dashboard policy identical", () => {
    expect(readFileSync(resolve(here, "sentry-policy.ts"), "utf8")).toBe(
      readFileSync(resolve(here, "../../../dashboard/lib/sentry-policy.ts"), "utf8")
    );
  });

  it("resolves every installed SDK data collection category explicitly", () => {
    const client = new NodeClient({
      ...sentryPrivacyOptions,
      integrations: [],
      stackParser: defaultStackParser,
      transport: () => ({ send: async () => ({}), flush: async () => true }),
    });
    expect(client.getDataCollectionOptions()).toEqual({
      userInfo: false, cookies: false,
      httpHeaders: { request: false, response: false }, httpBodies: [],
      queryParams: false, graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false }, databaseQueryData: false,
      stackFrameVariables: false, frameContextLines: 7,
    });
    expect(sentryPrivacyOptions.beforeSendTransaction()).toBeNull();
    expect(sentryPrivacyOptions.tracePropagationTargets).toEqual([]);
    expect(sentryPrivacyOptions.enableLogs).toBe(false);
  });

  it("sends scrubbed errors through the real SDK transport without network access", async () => {
    const envelopes: unknown[] = [];
    const client = new NodeClient({
      ...sentryPrivacyOptions,
      dsn: "https://public@example.invalid/1",
      integrations: [],
      stackParser: defaultStackParser,
      beforeSend: (event) => safeSanitizeSentryEvent(event),
      transport: () => ({
        send: async (envelope) => { envelopes.push(envelope); return {}; },
        flush: async () => true,
      }),
    });
    client.captureEvent({
      environment: "production",
      exception: { values: [{ type: "Error", value: "kept", stacktrace: {
        frames: [{ filename: "index.ts", lineno: 42, vars: { secret: "private" } }],
      } }] },
      user: { email: "private@example.invalid", ip_address: "192.0.2.1" },
      request: { url: "/ingest?secret=private", data: "private", cookies: { session: "private" },
        headers: { Authorization: "private", "X-API-Key": "tt_live_example" } },
      contexts: { db: { query: "private" }, ai: { inputs: "private" }, response: { body: "private" } },
    });
    expect(await client.flush(1000)).toBe(true);
    expect(envelopes).toHaveLength(1);
    const wire = JSON.stringify(envelopes);
    expect(wire).not.toContain("private");
    expect(wire).not.toContain("tt_live_");
    expect(wire).not.toContain("192.0.2.1");
    expect(wire).toContain('"value":"kept"');
    expect(wire).toContain('"filename":"index.ts"');
    expect(wire).toContain('"environment":"production"');
  });

  it("strips response, DB, AI, GraphQL and frame variables while keeping errors", () => {
    const event = {
      environment: "production", message: "failure tt_live_example",
      exception: { values: [{ type: "Error", value: "failure", stacktrace: {
        frames: [{ filename: "index.ts", lineno: 42, vars: { payload: "secret" } }],
      } }] },
      user: { ip_address: "192.0.2.1" },
      request: { data: "body", env: { REMOTE_ADDR: "192.0.2.1" } },
      contexts: { response: { body: "secret" }, db: { query: "secret" },
        ai: { inputs: "secret" }, graphql: { variables: "secret" } },
      extra: { "db.query.text": "SELECT secret", "gen_ai.prompt": "secret" },
    };
    const sent = safeSanitizeSentryEvent(event);
    expect(sent.contexts).toEqual({});
    expect(sent.extra).toEqual({});
    expect(sent.user).toBeUndefined();
    expect(sent.request).toEqual({ env: {} });
    expect(sent.message).toBe("failure [redacted]");
    expect(sent.environment).toBe("production");
    expect(sent.exception.values[0]).toEqual({ type: "Error", value: "failure",
      stacktrace: { frames: [{ filename: "index.ts", lineno: 42 }] } });
  });

  it("scrubs breadcrumbs before storage and drops unstructured payload categories", () => {
    for (const category of ["console", "db", "db.query", "gen_ai.request", "graphql"]) {
      expect(sanitizeSentryBreadcrumb({ category, message: "customer payload" })).toBeNull();
    }
    expect(sanitizeSentryBreadcrumb({ category: "navigation", data: {
      to: "/dashboard?token=secret", from: "/login?email=secret",
      headers: { Authorization: "secret", "X-API-Key": "secret", Cookie: "secret", "Set-Cookie": "secret" },
      body: "secret", user: { email: "secret" }, key: "tt_live_example",
    } })).toEqual({ category: "navigation", data: {
      to: "/dashboard", from: "/login", headers: {}, key: "[redacted]",
    } });
  });
});
