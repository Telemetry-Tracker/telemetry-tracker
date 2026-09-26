import { toReportableError } from "@telemetry-tracker/core";
/** Bound how long a crashing process waits for the error ingest request. */
export const FATAL_FLUSH_TIMEOUT_MS = 2000;
/** Prevents double exit when strict mode raises rejection as uncaughtException too. */
let fatalFlushInProgress = false;
/**
 * Report a fatal error, wait up to `timeoutMs` for ingest, then exit(1).
 * Accepts any thrown value (null/undefined/primitives/objects).
 * Clears the timeout when ingest settles so the timer does not keep the process alive.
 */
export function flushFatalError(thrown, source, deps) {
    if (fatalFlushInProgress)
        return;
    fatalFlushInProgress = true;
    const err = toReportableError(thrown);
    const timeoutMs = deps.timeoutMs ?? FATAL_FLUSH_TIMEOUT_MS;
    let settled = false;
    let timeoutId;
    const flush = deps.ingest(err, { source }).catch(() => undefined);
    const timer = new Promise((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
        const handle = timeoutId;
        if (typeof handle.unref === "function")
            handle.unref();
    });
    const finish = () => {
        if (settled)
            return;
        settled = true;
        fatalFlushInProgress = false;
        if (timeoutId !== undefined)
            clearTimeout(timeoutId);
        deps.exit(1);
    };
    void Promise.race([flush, timer]).finally(finish);
}
/** @internal test helper */
export function resetFatalFlushStateForTests() {
    fatalFlushInProgress = false;
}
