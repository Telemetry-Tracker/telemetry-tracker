import { toReportableError } from "@telemetry-tracker/core";
/** Bound how long a crashing process waits for the error ingest request. */
export const FATAL_FLUSH_TIMEOUT_MS = 2000;
/** Prevents double exit when strict mode raises rejection as uncaughtException too. */
let fatalFlushInProgress = false;
function safeExit(deps) {
    try {
        deps.exit(1);
    }
    catch {
        // ignore — never throw from the crash handler
    }
}
/**
 * Report a fatal error, wait up to `timeoutMs` for ingest, then exit(1).
 * Accepts any thrown value (null/undefined/primitives/objects).
 * Clears the timeout when ingest settles so the timer does not keep the process alive.
 * Telemetry-internal failures must not escape (would become Node exit code 7).
 */
export function flushFatalError(thrown, source, deps) {
    try {
        if (fatalFlushInProgress)
            return;
        fatalFlushInProgress = true;
        const timeoutMs = deps.timeoutMs ?? FATAL_FLUSH_TIMEOUT_MS;
        let settled = false;
        let timeoutId;
        let flush;
        try {
            const err = toReportableError(thrown);
            let pending;
            try {
                pending = Promise.resolve(deps.ingest(err, { source }));
            }
            catch {
                pending = Promise.resolve();
            }
            flush = pending.catch(() => undefined);
        }
        catch {
            flush = Promise.resolve();
        }
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
            if (timeoutId !== undefined) {
                try {
                    clearTimeout(timeoutId);
                }
                catch {
                    // ignore
                }
            }
            safeExit(deps);
        };
        void Promise.race([flush, timer]).then(finish, finish);
    }
    catch {
        fatalFlushInProgress = false;
        safeExit(deps);
    }
}
/** @internal test helper */
export function resetFatalFlushStateForTests() {
    fatalFlushInProgress = false;
}
