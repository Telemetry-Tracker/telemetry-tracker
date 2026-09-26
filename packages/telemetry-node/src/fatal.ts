import { toReportableError } from "@telemetry-tracker/core";

/** Bound how long a crashing process waits for the error ingest request. */
export const FATAL_FLUSH_TIMEOUT_MS = 2000;

export type FatalFlushDeps = {
  ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
  exit: (code: number) => void;
  /** Override the default {@link FATAL_FLUSH_TIMEOUT_MS}. */
  timeoutMs?: number;
};

/** Prevents double exit when strict mode raises rejection as uncaughtException too. */
let fatalFlushInProgress = false;

/**
 * Report a fatal error, wait up to `timeoutMs` for ingest, then exit(1).
 * Accepts any thrown value (null/undefined/primitives/objects).
 * Clears the timeout when ingest settles so the timer does not keep the process alive.
 */
export function flushFatalError(
  thrown: unknown,
  source: string,
  deps: FatalFlushDeps
): void {
  if (fatalFlushInProgress) return;
  fatalFlushInProgress = true;

  const err = toReportableError(thrown);
  const timeoutMs = deps.timeoutMs ?? FATAL_FLUSH_TIMEOUT_MS;
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const flush = deps.ingest(err, { source }).catch(() => undefined);

  const timer = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
    const handle = timeoutId as { unref?: () => void };
    if (typeof handle.unref === "function") handle.unref();
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    fatalFlushInProgress = false;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    deps.exit(1);
  };

  void Promise.race([flush, timer]).finally(finish);
}

/** @internal test helper */
export function resetFatalFlushStateForTests(): void {
  fatalFlushInProgress = false;
}
