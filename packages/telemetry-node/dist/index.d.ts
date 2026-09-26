import { identify, trackEvent, trackError as coreTrackError, type TelemetryConfig } from "@telemetry-tracker/core";
export type TelemetryNodeConfig = TelemetryConfig & {
    app: string;
    platform?: string;
    /**
     * When true (default), report an unhandled rejection, flush ingest, then
     * `process.exit(1)` — matching Node’s default crash since v15. Set `false`
     * to only report and keep the process running (legacy 1.3.x behaviour).
     */
    exitOnUnhandledRejection?: boolean;
};
export { FATAL_FLUSH_TIMEOUT_MS, flushFatalError } from "./fatal.js";
/** @internal Exported for unit tests. */
export declare function createUncaughtExceptionHandler(deps: {
    ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
    exit: (code: number) => void;
}): (err: Error) => void;
/** @internal Exported for unit tests. */
export declare function createUnhandledRejectionHandler(deps: {
    exitOnUnhandledRejection: boolean;
    ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
    trackError: (error: Error, context: Record<string, unknown>) => void;
    exit: (code: number) => void;
}): (reason: unknown) => void;
export declare function init(config: TelemetryNodeConfig): void;
export { identify, trackEvent, coreTrackError as trackError };
export declare function getConfig(): TelemetryConfig | null;
type MaybeEmitter = {
    on?(event: string, listener: () => void): void;
};
/**
 * Generic (req, res, next) middleware. Times duration until the **response**
 * finishes (`finish`/`close`), not the request body stream.
 */
export declare function middleware(opts?: {
    trackRequestBody?: boolean;
}): (req: {
    method?: string;
    url?: string;
    body?: unknown;
}, res: MaybeEmitter | unknown, next: () => void) => void;
