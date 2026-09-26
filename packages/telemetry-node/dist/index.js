import { init as coreInit, identify, trackEvent, trackError as coreTrackError, ingestError, getConfigOrNull, toReportableError, } from "@telemetry-tracker/core";
import { FATAL_FLUSH_TIMEOUT_MS, flushFatalError } from "./fatal.js";
export { FATAL_FLUSH_TIMEOUT_MS, flushFatalError } from "./fatal.js";
let installed = false;
let exitOnUnhandledRejection = true;
let fatalFlushTimeoutMs = FATAL_FLUSH_TIMEOUT_MS;
/** @internal Exported for unit tests. */
export function createUncaughtExceptionHandler(deps) {
    return (err) => {
        flushFatalError(err, "uncaughtException", deps);
    };
}
/** @internal Exported for unit tests. */
export function createUnhandledRejectionHandler(deps) {
    return (reason) => {
        const err = toReportableError(reason);
        if (deps.exitOnUnhandledRejection) {
            flushFatalError(err, "unhandledRejection", {
                ingest: deps.ingest,
                exit: deps.exit,
                timeoutMs: deps.timeoutMs,
            });
            return;
        }
        deps.trackError(err, { source: "unhandledRejection" });
    };
}
function installGlobalHandlers() {
    if (installed)
        return;
    installed = true;
    process.on("uncaughtException", createUncaughtExceptionHandler({
        ingest: ingestError,
        exit: (code) => process.exit(code),
        get timeoutMs() {
            return fatalFlushTimeoutMs;
        },
    }));
    process.on("unhandledRejection", createUnhandledRejectionHandler({
        get exitOnUnhandledRejection() {
            return exitOnUnhandledRejection;
        },
        ingest: ingestError,
        trackError: coreTrackError,
        exit: (code) => process.exit(code),
        get timeoutMs() {
            return fatalFlushTimeoutMs;
        },
    }));
}
export function init(config) {
    exitOnUnhandledRejection = config.exitOnUnhandledRejection !== false;
    fatalFlushTimeoutMs =
        typeof config.fatalFlushTimeoutMs === "number" &&
            Number.isFinite(config.fatalFlushTimeoutMs) &&
            config.fatalFlushTimeoutMs >= 0
            ? config.fatalFlushTimeoutMs
            : FATAL_FLUSH_TIMEOUT_MS;
    coreInit({ ...config, platform: config.platform ?? "node" });
    installGlobalHandlers();
}
export { identify, trackEvent, coreTrackError as trackError };
export function getConfig() {
    return getConfigOrNull();
}
/**
 * Generic (req, res, next) middleware. Times duration until the **response**
 * finishes (`finish`/`close`), not the request body stream.
 */
export function middleware(opts) {
    const trackRequestBody = opts?.trackRequestBody ?? false;
    return function telemetryMiddleware(req, res, next) {
        const cfg = getConfigOrNull();
        if (!cfg) {
            next();
            return;
        }
        const start = Date.now();
        const method = req.method ?? "GET";
        const url = req.url ?? "";
        let finished = false;
        const done = () => {
            if (finished)
                return;
            finished = true;
            const duration = Date.now() - start;
            trackEvent("$request", {
                method,
                url,
                duration_ms: duration,
                ...(trackRequestBody && req.body ? { body: req.body } : {}),
            });
        };
        const resWithOn = res;
        const canWatchResponse = typeof resWithOn?.on === "function";
        if (canWatchResponse) {
            resWithOn.on("finish", done);
            resWithOn.on("close", done);
        }
        next();
        // Frameworks without a Node response emitter (e.g. plain objects / some
        // Fastify adapters): record once after next(), never call next twice.
        if (!canWatchResponse) {
            done();
        }
    };
}
