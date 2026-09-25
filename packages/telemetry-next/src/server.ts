/**
 * Server-side error capture for the Next.js App Router.
 *
 * Wire `onRequestError` from `instrumentation.ts`. The hook uses `fetch` only,
 * so the same function runs on the Node.js and Edge runtimes.
 *
 * Captured: uncaught errors Next.js reports through `onRequestError` — Server
 * Component render, Route Handlers, and Server Actions that escape the function.
 *
 * Not captured:
 * - errors you catch and do not rethrow
 * - browser / Client Component errors (use `TelemetryProvider` for those)
 * - build-time and compile errors
 * - `after()` or background work that never surfaces as a request error
 * - Pages Router (the hook still receives `routerKind`, but this package only
 *   documents App Router behavior)
 */

export type ServerTelemetryConfig = {
  ingestUrl: string;
  apiKey?: string;
  app: string;
  environment?: string;
  release?: string;
  platform?: string;
};

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
    runtime: string;
    routerKind: string;
    routePath: string;
    routeType: string;
    renderSource?: string;
    method: string;
    path: string;
  };
};

export function serverErrorPayload(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
  config: ServerTelemetryConfig
): ServerErrorPayload {
  const err = error instanceof Error ? error : new Error(String(error));
  const runtime = typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime === "string"
    ? "edge"
    : "nodejs";
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
      runtime,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      method: request.method,
      path: request.path,
    },
  };
}

export function createOnRequestError(config: ServerTelemetryConfig) {
  return async function onRequestError(
    error: unknown,
    request: RequestErrorRequest,
    context: RequestErrorContext
  ): Promise<void> {
    const ingestUrl = config.ingestUrl?.trim().replace(/\/$/, "");
    if (!ingestUrl || !config.app?.trim()) return;
    const payload = serverErrorPayload(error, request, context, config);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = config.apiKey?.trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    try {
      const res = await fetch(`${ingestUrl}/ingest/error`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn("[telemetry] server ingest failed:", res.status);
      }
    } catch (sendError) {
      console.warn("[telemetry] server send error:", sendError);
    }
  };
}
