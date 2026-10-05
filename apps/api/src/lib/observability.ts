import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { safeSanitizeSentryEvent } from "./sentry-privacy.js";

let sentryInitialized = false;

/**
 * Optional Sentry (`SENTRY_DSN`). Skipped in tests and when DSN is unset.
 * Call from `index.ts` before dynamically importing `./app.js` so OpenTelemetry
 * instrumentation can patch http, database clients, etc. Do not rely on calling this from `createApp()`.
 */
export async function initSentryIfConfigured(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || sentryInitialized) return;
  const Sentry = await import("@sentry/node");
  // Do not set a partial `dataCollection` object. In Sentry 10.66.0 that
  // ignores `sendDefaultPii` and turns the permissive defaults on.
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
    includeLocalVariables: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      return safeSanitizeSentryEvent(event);
    },
    integrations(integrations) {
      return integrations.map((integration) =>
        integration.name === "Http"
          ? Sentry.httpIntegration({ maxIncomingRequestBodySize: "none" })
          : integration
      );
    },
  });
  sentryInitialized = true;
}

/** Request id + error logging + optional Sentry capture on `onError`. */
export function registerObservabilityHooks(app: FastifyInstance): void {
  app.addHook("onError", async (request, _reply, error) => {
    request.log.error(
      { err: error, reqId: request.id, url: request.url, method: request.method },
      error.message
    );
    if (process.env.NODE_ENV === "test" || !process.env.SENTRY_DSN?.trim()) return;
    try {
      const Sentry = await import("@sentry/node");
      Sentry.captureException(error);
    } catch {
      /* optional dep failed to load */
    }
  });
}

export function genReqId(): string {
  return randomUUID();
}
