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

/** Shared init options for client, server, and edge runtimes. */
export function sentryInitOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  } as const;
}

/** Client-side capture from error boundaries; no-op when DSN is unset. */
export function captureClientException(error: unknown): void {
  if (!isClientSentryEnabled()) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
}
