/** Bound how long a crashing process waits for the error ingest request. */
export declare const FATAL_FLUSH_TIMEOUT_MS = 2000;
export type FatalFlushDeps = {
    ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
    exit: (code: number) => void;
    /** Override the default {@link FATAL_FLUSH_TIMEOUT_MS}. */
    timeoutMs?: number;
};
/**
 * TT-022 (#724): turn any thrown value into a plain Error whose message/stack are own string
 * properties, so ingest never touches user-defined getters or Proxy traps. Falls back to a
 * generic Error when inspecting the value throws.
 */
export declare function toSafeFatalError(thrown: unknown): Error;
/**
 * Report a fatal error, wait up to `timeoutMs` for ingest, then exit(1).
 * Accepts any thrown value (null/undefined/primitives/objects).
 * Clears the timeout when ingest settles so the timer does not keep the process alive.
 * Telemetry-internal failures must not escape (would become Node exit code 7).
 */
export declare function flushFatalError(thrown: unknown, source: string, deps: FatalFlushDeps): void;
/** @internal test helper */
export declare function resetFatalFlushStateForTests(): void;
