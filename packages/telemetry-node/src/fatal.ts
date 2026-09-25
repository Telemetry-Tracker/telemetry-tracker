/** Bound how long a crashing process waits for the error ingest request. */
export const FATAL_FLUSH_TIMEOUT_MS = 2000;

export function flushFatalError(
  err: Error,
  source: string,
  deps: {
    ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
    exit: (code: number) => void;
    timeoutMs?: number;
  }
): void {
  const timeoutMs = deps.timeoutMs ?? FATAL_FLUSH_TIMEOUT_MS;
  const flush = deps.ingest(err, { source }).catch(() => undefined);
  const timer = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  void Promise.race([flush, timer]).finally(() => {
    deps.exit(1);
  });
}
