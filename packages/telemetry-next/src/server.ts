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
 * strings from the path, skips an Error already marked with the shared
 * `telemetry.reported` symbol (and recent Next.js digests), and aborts a hung
 * ingest after a few seconds so Next.js error handling is not blocked.
 */

/** Shared with `@telemetry-tracker/core` so the same Error is not reported twice. */
const REPORTED = Symbol.for("telemetry.reported");

const MAX_RECENT_DIGESTS = 256;
const INGEST_TIMEOUT_MS = 3000;

/** Process-local Next.js error digests already sent (best-effort duplicate skip). */
const recentDigests = new Set<string>();

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

export const SERVER_SDK_VERSION = "1.3.2";

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
  if ((error as Record<symbol, boolean>)[REPORTED]) return true;
  const digest = errorDigest(error);
  return digest != null && recentDigests.has(digest);
}

export function markReported(error: unknown): void {
  if (!error || typeof error !== "object") return;
  try {
    (error as Record<symbol, boolean>)[REPORTED] = true;
  } catch {
    // Error object may be frozen; digest set still helps.
  }
  const digest = errorDigest(error);
  if (!digest) return;
  if (recentDigests.size >= MAX_RECENT_DIGESTS) recentDigests.clear();
  recentDigests.add(digest);
}

/** @internal test helper */
export function clearReportedDigestsForTests(): void {
  recentDigests.clear();
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
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = errorDigest(error);
  return {
    app: config.app,
    message: err.message || "Unknown server error",
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
