import {
  init as coreInit,
  identify,
  trackEvent,
  trackError as coreTrackError,
  ingestError,
  getConfigOrNull,
  type TelemetryConfig,
} from "@telemetry-tracker/core";
import { flushFatalError } from "./fatal.js";

export type TelemetryNodeConfig = TelemetryConfig & {
  app: string;
  platform?: string;
  /**
   * When true (default), report an unhandled rejection, flush ingest, then
   * `process.exit(1)` — matching Node’s default crash since v15. Set `false`
   * to only report and keep the process running (legacy 1.3.x behaviour).
   */
  exitOnUnhandledRejection?: boolean;
};

export { FATAL_FLUSH_TIMEOUT_MS, flushFatalError } from "./fatal.js";

let installed = false;
let exitOnUnhandledRejection = true;

/** @internal Exported for unit tests. */
export function createUncaughtExceptionHandler(deps: {
  ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
  exit: (code: number) => void;
}): (err: Error) => void {
  return (err: Error) => {
    flushFatalError(err, "uncaughtException", deps);
  };
}

/** @internal Exported for unit tests. */
export function createUnhandledRejectionHandler(deps: {
  exitOnUnhandledRejection: boolean;
  ingest: (error: Error, context: Record<string, unknown>) => Promise<void>;
  trackError: (error: Error, context: Record<string, unknown>) => void;
  exit: (code: number) => void;
}): (reason: unknown) => void {
  return (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    if (deps.exitOnUnhandledRejection) {
      flushFatalError(err, "unhandledRejection", {
        ingest: deps.ingest,
        exit: deps.exit,
      });
      return;
    }
    deps.trackError(err, { source: "unhandledRejection" });
  };
}

function installGlobalHandlers(): void {
  if (installed) return;
  installed = true;

  process.on(
    "uncaughtException",
    createUncaughtExceptionHandler({
      ingest: ingestError,
      exit: (code) => process.exit(code),
    })
  );

  process.on(
    "unhandledRejection",
    createUnhandledRejectionHandler({
      get exitOnUnhandledRejection() {
        return exitOnUnhandledRejection;
      },
      ingest: ingestError,
      trackError: coreTrackError,
      exit: (code) => process.exit(code),
    })
  );
}

export function init(config: TelemetryNodeConfig): void {
  exitOnUnhandledRejection = config.exitOnUnhandledRejection !== false;
  coreInit({ ...config, platform: config.platform ?? "node" });
  installGlobalHandlers();
}

export { identify, trackEvent, coreTrackError as trackError };

export function getConfig(): TelemetryConfig | null {
  return getConfigOrNull();
}

type MaybeEmitter = {
  on?(event: string, listener: () => void): void;
};

/**
 * Generic (req, res, next) middleware. Times duration until the **response**
 * finishes (`finish`/`close`), not the request body stream.
 */
export function middleware(opts?: { trackRequestBody?: boolean }) {
  const trackRequestBody = opts?.trackRequestBody ?? false;
  return function telemetryMiddleware(
    req: { method?: string; url?: string; body?: unknown },
    res: MaybeEmitter | unknown,
    next: () => void
  ): void {
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
      if (finished) return;
      finished = true;
      const duration = Date.now() - start;
      trackEvent("$request", {
        method,
        url,
        duration_ms: duration,
        ...(trackRequestBody && req.body ? { body: req.body } : {}),
      });
    };

    const resWithOn = res as MaybeEmitter;
    const canWatchResponse = typeof resWithOn?.on === "function";
    if (canWatchResponse) {
      resWithOn.on!("finish", done);
      resWithOn.on!("close", done);
    }

    next();

    // Frameworks without a Node response emitter (e.g. plain objects / some
    // Fastify adapters): record once after next(), never call next twice.
    if (!canWatchResponse) {
      done();
    }
  };
}
