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
export const SERVER_SDK_VERSION = "1.3.2";
export function serverErrorPayload(error, request, context, config) {
    const err = error instanceof Error ? error : new Error(String(error));
    const runtime = typeof globalThis.EdgeRuntime === "string"
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
export function createOnRequestError(config) {
    return async function onRequestError(error, request, context) {
        const ingestUrl = config.ingestUrl?.trim().replace(/\/$/, "");
        if (!ingestUrl || !config.app?.trim())
            return;
        const payload = serverErrorPayload(error, request, context, config);
        const headers = { "Content-Type": "application/json" };
        const key = config.apiKey?.trim();
        if (key)
            headers.Authorization = `Bearer ${key}`;
        try {
            const res = await fetch(`${ingestUrl}/ingest/error`, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                console.warn("[telemetry] server ingest failed:", res.status);
            }
        }
        catch (sendError) {
            console.warn("[telemetry] server send error:", sendError);
        }
    };
}
