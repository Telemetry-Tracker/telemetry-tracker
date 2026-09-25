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
    headers?: {
        [key: string]: string | string[] | undefined;
    };
};
export type RequestErrorContext = {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware" | "proxy";
    renderSource?: "react-server-components" | "react-server-components-payload" | "server-rendering";
};
export declare const SERVER_SDK_VERSION = "1.3.2";
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
/** Path only — drop query/hash so tokens in the URL are not ingested. */
export declare function safeRequestPath(path: string): string;
export declare function wasAlreadyReported(error: unknown): boolean;
export declare function markReported(error: unknown): void;
/** @internal test helper */
export declare function clearReportedDigestsForTests(): void;
export declare function serverErrorPayload(error: unknown, request: RequestErrorRequest, context: RequestErrorContext, config: ServerTelemetryConfig): ServerErrorPayload;
export declare function createOnRequestError(config: ServerTelemetryConfig): (error: unknown, request: RequestErrorRequest, context: RequestErrorContext) => Promise<void>;
