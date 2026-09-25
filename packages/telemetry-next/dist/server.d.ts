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
        runtime: string;
        routerKind: string;
        routePath: string;
        routeType: string;
        renderSource?: string;
        method: string;
        path: string;
    };
};
export declare function serverErrorPayload(error: unknown, request: RequestErrorRequest, context: RequestErrorContext, config: ServerTelemetryConfig): ServerErrorPayload;
export declare function createOnRequestError(config: ServerTelemetryConfig): (error: unknown, request: RequestErrorRequest, context: RequestErrorContext) => Promise<void>;
