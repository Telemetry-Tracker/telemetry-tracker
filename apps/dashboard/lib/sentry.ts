import type { ErrorEvent } from "@sentry/nextjs";
import { safeSanitizeSentryEvent } from "./sentry-privacy";

/**
 * Next.js 10.66.0 installs Http with only `disableIncomingRequestSpans: true`.
 * Replacing that integration must keep the same flag. `none` disables incoming
 * request-body buffering. Other Http options stay unset, matching Next's call.
 */
export const dashboardServerHttpIntegrationOptions = {
  disableIncomingRequestSpans: true,
  maxIncomingRequestBodySize: "none",
} as const;

export function replaceHttpIntegration<T extends { name: string }>(
  integrations: T[],
  httpIntegration: T
): T[] {
  return integrations.map((integration) =>
    integration.name === "Http" ? httpIntegration : integration
  );
}

/** Server / edge DSN. Skipped in tests and when unset (mirrors API observability). */
export function getServerSentryDsn(): string | undefined {
  if (process.env.NODE_ENV === "test") return undefined;
  const dsn = process.env.SENTRY_DSN?.trim();
  return dsn || undefined;
}

/** Browser DSN (`NEXT_PUBLIC_*`). Skipped in tests and when unset. */
export function getClientSentryDsn(): string | undefined {
  if (process.env.NODE_ENV === "test") return undefined;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  return dsn || undefined;
}

export function isServerSentryEnabled(): boolean {
  return Boolean(getServerSentryDsn());
}

export function isClientSentryEnabled(): boolean {
  return Boolean(getClientSentryDsn());
}

/**
 * Shared init options for client, server, and edge runtimes.
 * `includeLocalVariables` is a plain boolean. This module does not import
 * `@sentry/node`. Browser init still runs only when `NEXT_PUBLIC_SENTRY_DSN` is set.
 */
export function sentryInitOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
    includeLocalVariables: false,
    tracesSampleRate: 0,
    beforeSend(event: ErrorEvent) {
      return safeSanitizeSentryEvent(event);
    },
  };
}

/** Client-side capture from error boundaries; no-op when DSN is unset. */
export function captureClientException(error: unknown): void {
  if (isClientSentryEnabled()) {
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }
  if (typeof window === "undefined") return;
  // Re-check window inside async callbacks — Vitest/jsdom can tear down
  // `window` after the synchronous call returns (unhandled rejection otherwise).
  void import("@/lib/product-telemetry").then(({ shouldTrackProductTelemetry }) => {
    if (typeof window === "undefined" || typeof window.location === "undefined") return;
    if (!shouldTrackProductTelemetry(window.location.pathname)) return;
    void import("@telemetry-tracker/next").then(({ trackError }) => {
      if (typeof window === "undefined") return;
      const err = error instanceof Error ? error : new Error(String(error));
      trackError(err, { source: "next-error-boundary" });
    });
  });
}
