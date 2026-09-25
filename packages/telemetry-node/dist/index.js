import { init as coreInit, identify, trackEvent, trackError as coreTrackError, ingestError, getConfigOrNull, } from "@telemetry-tracker/core";
import { flushFatalError } from "./fatal.js";
export { FATAL_FLUSH_TIMEOUT_MS, flushFatalError } from "./fatal.js";
let installed = false;
function installGlobalHandlers() {
    if (installed)
        return;
    installed = true;
    process.on("uncaughtException", (err) => {
        flushFatalError(err, "uncaughtException", {
            ingest: ingestError,
            exit: (code) => process.exit(code),
        });
    });
    process.on("unhandledRejection", (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        coreTrackError(err, { source: "unhandledRejection" });
    });
}
export function init(config) {
    coreInit({ ...config, platform: config.platform ?? "node" });
    installGlobalHandlers();
}
export { identify, trackEvent, coreTrackError as trackError };
export function getConfig() {
    return getConfigOrNull();
}
export function middleware(opts) {
    const trackRequestBody = opts?.trackRequestBody ?? false;
    return function telemetryMiddleware(req, _res, next) {
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
        const reqWithOn = req;
        if (typeof reqWithOn.on === "function") {
            reqWithOn.on("end", done);
            reqWithOn.on("close", done);
        }
        else {
            next();
            done();
        }
        next();
    };
}
