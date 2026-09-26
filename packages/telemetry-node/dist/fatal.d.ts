/** Bound how long a crashing process waits for the error ingest request. */
export declare const FATAL_FLUSH_TIMEOUT_MS = 2000;
export type FatalFlushDeps = {
    ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
    exit: (code: number) => void;
    /** Override the default {@link FATAL_FLUSH_TIMEOUT_MS}. */
    timeoutMs?: number;
};
/**
 * Report a fatal error, wait up to `timeoutMs` for ingest, then exit(1).
 * Accepts any thrown value (null/undefined/primitives/objects).
 * Clears the timeout when ingest settles so the timer does not keep the process alive.
 */
export declare function flushFatalError(thrown: unknown, source: string, deps: FatalFlushDeps): void;
/** @internal test helper */
export declare function resetFatalFlushStateForTests(): void;
