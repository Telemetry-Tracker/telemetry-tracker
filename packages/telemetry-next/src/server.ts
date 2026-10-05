/**
 * Server-side error capture for the Next.js App Router.
 *
 * Wire `onRequestError` from `instrumentation.ts`. The hook uses `fetch` only,
 * so the same function runs on the Node.js and Edge runtimes.
 *
 * Captured: uncaught errors Next.js reports through `onRequestError` — Server
 * Component render (`routeType: "render"`), Route Handlers (`"route"`), and
 * Server Actions (`"action"`) that escape the function.
 *
 * Not captured:
 * - errors you catch and do not rethrow
 * - browser / Client Component errors (use `TelemetryProvider` for those)
 * - build-time and compile errors
 * - `after()` or background work that never surfaces as a request error
 * - Pages Router (the hook still receives `routerKind`, but this package only
 *   documents App Router behavior)
 *
 * Safety: the hook never throws, never copies request headers, strips query
 * strings from the path, reports a given Error object only once, collapses a
 * second same-digest callback in the same turn, and aborts a hung ingest after
 * a few seconds so Next.js error handling is not blocked.
 *
 * Next.js 15+ calls `onRequestError` (the hook does not exist on Next.js 14).
 * The browser package still supports Next.js 14.
 */

/**
 * Marks an Error this process has already sent. `@telemetry-tracker/core` uses
 * its own WeakSet in the browser bundle; this symbol is only for server hooks
 * that see the same object again.
 */
const REPORTED = Symbol.for("telemetry.reported");

const INGEST_TIMEOUT_MS = 3000;

/**
 * Identity dedupe. A WeakSet does not mutate the Error, so frozen objects are
 * covered when assigning `REPORTED` throws.
 */
const reportedErrors = new WeakSet<object>();

/**
 * Digests already passed to this hook during the current synchronous turn.
 *
 * Next.js awaits `onRequestError`, but React's `onError` does not await that
 * promise. A second callback for the same throw can therefore start before the
 * first yield, with a different object that still carries the same digest
 * (React does not preserve the original instance). Next 15.5 already skips the
 * SSR callback when the RSC handler stored the digest; this guard covers a
 * re-entrant second call in that same turn.
 *
 * The set is cleared on a microtask, before Node dequeues another request, so
 * a later request with the same digest is reported again. A process-wide set
 * is not used: Next's digest is a stable hash of the error, and keeping it
 * would drop occurrence counts, affected users, and spike alerts.
 */
const digestsThisTurn = new Set<string>();
let digestTurnEpoch = 0;

export type ServerTelemetryConfig = {
  ingestUrl: string;
  apiKey?: string;
  app: string;
  environment?: string;
  release?: string;
  platform?: string;
};

/**
 * Next.js passes `headers` on the request object. This SDK intentionally does
 * not read or forward them (cookies, authorization, etc.).
 */
export type RequestErrorRequest = {
  path: string;
  method: string;
  headers?: { [key: string]: string | string[] | undefined };
};

export type RequestErrorContext = {
  routerKind: "Pages Router" | "App Router";
  routePath: string;
  routeType: "render" | "route" | "action" | "middleware" | "proxy";
  renderSource?:
    | "react-server-components"
    | "react-server-components-payload"
    | "server-rendering";
};

export const SERVER_SDK_VERSION = "1.3.3";

export type ServerErrorPayload = {
  app: string;
  message: string;
  stack?: string;
  platform?: string;
  environment?: string;
  release?: string;
  sdk_version: string;
  context: {
    source: "next.onRequestError";
    runtime: "edge" | "nodejs";
    routerKind: string;
    routePath: string;
    routeType: string;
    renderSource?: string;
    method: string;
    path: string;
    digest?: string;
  };
};

function detectRuntime(): "edge" | "nodejs" {
  return typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime === "string"
    ? "edge"
    : "nodejs";
}

/** Path only — drop query/hash so tokens in the URL are not ingested. */
export function safeRequestPath(path: string): string {
  const noHash = path.split("#", 1)[0] ?? path;
  const q = noHash.indexOf("?");
  return q === -1 ? noHash : noHash.slice(0, q);
}

function errorDigest(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.length > 0 ? digest : undefined;
}

export function wasAlreadyReported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (reportedErrors.has(error)) return true;
  try {
    return Boolean((error as Record<symbol, boolean>)[REPORTED]);
  } catch {
    return false;
  }
}

export function markReported(error: unknown): void {
  if (!error || typeof error !== "object") return;
  reportedErrors.add(error);
  try {
    (error as Record<symbol, boolean>)[REPORTED] = true;
  } catch {
    // Frozen or sealed. The WeakSet still records the object.
  }
}

/**
 * @returns true when this digest was already seen in the current turn.
 * The first sighting is recorded and expires on the next microtask.
 */
function claimDigestThisTurn(digest: string): boolean {
  if (digestsThisTurn.has(digest)) return true;
  digestsThisTurn.add(digest);
  const epoch = digestTurnEpoch;
  const clear = () => {
    if (epoch !== digestTurnEpoch) return;
    digestsThisTurn.delete(digest);
  };
  if (typeof queueMicrotask === "function") queueMicrotask(clear);
  else Promise.resolve().then(clear);
  return false;
}

/** @internal test helper */
export function clearReportedDigestsForTests(): void {
  digestTurnEpoch += 1;
  digestsThisTurn.clear();
}

/**
 * Read message and stack without relying on `instanceof Error`.
 * Edge isolates can hand the hook an Error from another realm, where
 * `instanceof` is false and `String(error)` becomes `"Error: <message>"`.
 */
export function readServerError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || "Unknown server error",
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; stack?: unknown };
    if (typeof record.message === "string" && record.message.length > 0) {
      return {
        message: record.message,
        stack: typeof record.stack === "string" ? record.stack : undefined,
      };
    }
  }
  const fallback = error == null ? "" : String(error);
  return { message: fallback || "Unknown server error" };
}

function ingestAbortSignal(): AbortSignal | undefined {
  const AbortSignalCtor = (
    globalThis as {
      AbortSignal?: { timeout?: (ms: number) => AbortSignal };
    }
  ).AbortSignal;
  if (typeof AbortSignalCtor?.timeout === "function") {
    return AbortSignalCtor.timeout(INGEST_TIMEOUT_MS);
  }
  return undefined;
}

export function serverErrorPayload(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
  config: ServerTelemetryConfig
): ServerErrorPayload {
  const err = readServerError(error);
  const digest = errorDigest(error);
  return {
    app: config.app,
    message: err.message,
    stack: err.stack,
    platform: config.platform,
    environment: config.environment,
    release: config.release,
    sdk_version: SERVER_SDK_VERSION,
    context: {
      source: "next.onRequestError",
      runtime: detectRuntime(),
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      method: request.method,
      path: safeRequestPath(request.path),
      ...(digest ? { digest } : {}),
    },
  };
}

export function createOnRequestError(config: ServerTelemetryConfig) {
  return async function onRequestError(
    error: unknown,
    request: RequestErrorRequest,
    context: RequestErrorContext
  ): Promise<void> {
    try {
      if (wasAlreadyReported(error)) return;
      const ingestUrl = config.ingestUrl?.trim().replace(/\/$/, "");
      if (!ingestUrl || !config.app?.trim()) return;
      const digest = errorDigest(error);
      // Same-turn only. A later request with this digest must still be sent.
      if (digest && claimDigestThisTurn(digest)) return;
      markReported(error);
      // Intentionally ignore `request.headers` — never forward cookies or auth.
      const payload = serverErrorPayload(error, request, context, config);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const key = config.apiKey?.trim();
      if (key) headers.Authorization = `Bearer ${key}`;
      const signal = ingestAbortSignal();
      const res = await fetch(`${ingestUrl}/ingest/error`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        console.warn("[telemetry] server ingest failed:", res.status);
      }
    } catch (sendError) {
      console.warn("[telemetry] server send error:", sendError);
    }
  };
}
