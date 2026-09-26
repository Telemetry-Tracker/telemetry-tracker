/** Bound how long a crashing process waits for the error ingest request. */
export declare const FATAL_FLUSH_TIMEOUT_MS = 2000;
export declare function flushFatalError(err: Error, source: string, deps: {
    ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
    exit: (code: number) => void;
    timeoutMs?: number;
}): void;
