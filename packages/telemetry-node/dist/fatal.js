/** Bound how long a crashing process waits for the error ingest request. */
export const FATAL_FLUSH_TIMEOUT_MS = 2000;
export function flushFatalError(err, source, deps) {
    const timeoutMs = deps.timeoutMs ?? FATAL_FLUSH_TIMEOUT_MS;
    const flush = deps.ingest(err, { source }).catch(() => undefined);
    const timer = new Promise((resolve) => {
        setTimeout(resolve, timeoutMs);
    });
    void Promise.race([flush, timer]).finally(() => {
        deps.exit(1);
    });
}
