import { trackError } from "@telemetry-tracker/core";

/**
 * NestJS integration without a Nest/rxjs dependency (structural types only).
 *
 * Nest's ExceptionsHandler catches every controller/provider exception and turns it into an HTTP
 * response, so those errors never reach `uncaughtException` and were never reported (#920).
 */

type ObserverLike = {
  next(value: unknown): void;
  error(err: unknown): void;
  complete(): void;
};
type SubscriptionLike = { unsubscribe(): void };
type ObservableLike = {
  subscribe(observer: Partial<ObserverLike>): SubscriptionLike;
};
type ObservableCtor = new (subscribe: (subscriber: ObserverLike) => () => void) => ObservableLike;

/** Structural subset of Nest's `ExecutionContext` / `ArgumentsHost`. */
type NestContextLike = {
  getType?: () => string;
  switchToHttp?: () => { getRequest(): unknown };
  getClass?: () => { name?: string } | undefined;
  getHandler?: () => { name?: string } | undefined;
};

export type TelemetryInterceptorOptions = {
  /**
   * Decide whether an exception is reported. Default: everything except HTTP exceptions with a
   * status below 500 (e.g. `NotFoundException`, validation `BadRequestException`).
   */
  shouldReport?: (error: unknown) => boolean;
};

function httpStatusOf(error: unknown): number | undefined {
  const getStatus = (error as { getStatus?: unknown } | null)?.getStatus;
  if (typeof getStatus !== "function") return undefined;
  try {
    const s = getStatus.call(error);
    return typeof s === "number" ? s : undefined;
  } catch {
    return undefined;
  }
}

function defaultShouldReport(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status === undefined || status >= 500;
}

function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

function contextFor(host: NestContextLike | undefined): Record<string, unknown> {
  const ctx: Record<string, unknown> = { source: "nestjs" };
  if (!host) return ctx;
  try {
    const type = typeof host.getType === "function" ? host.getType() : undefined;
    if (type) ctx.nest_context = type;
    if ((type === undefined || type === "http") && typeof host.switchToHttp === "function") {
      const req = host.switchToHttp().getRequest() as
        | { method?: string; originalUrl?: string; url?: string }
        | undefined;
      if (req) {
        if (req.method) ctx.method = req.method;
        const url = req.originalUrl || req.url;
        if (url) ctx.path = stripQuery(url);
      }
    }
    const cls = typeof host.getClass === "function" ? host.getClass()?.name : undefined;
    const fn = typeof host.getHandler === "function" ? host.getHandler()?.name : undefined;
    if (cls || fn) ctx.handler = [cls, fn].filter(Boolean).join(".");
  } catch {
    // context is best-effort
  }
  return ctx;
}

/**
 * Report an exception caught by Nest (e.g. from your own `@Catch()` filter). Never throws.
 * HTTP exceptions below 500 are skipped unless `shouldReport` says otherwise.
 */
export function captureNestException(
  error: unknown,
  host?: NestContextLike,
  options?: TelemetryInterceptorOptions
): void {
  try {
    const should = options?.shouldReport ?? defaultShouldReport;
    if (!should(error)) return;
    trackError(error, contextFor(host));
  } catch {
    // never interfere with Nest's error response
  }
}

/**
 * Global Nest interceptor: reports exceptions thrown by controllers and the providers they call,
 * then rethrows them unchanged so Nest's exception filters build the same response as before.
 *
 * ```ts
 * app.useGlobalInterceptors(new TelemetryInterceptor());
 * ```
 */
export class TelemetryInterceptor {
  private readonly options: TelemetryInterceptorOptions | undefined;

  constructor(options?: TelemetryInterceptorOptions) {
    this.options = options;
  }

  intercept(context: NestContextLike, next: { handle(): ObservableLike }): ObservableLike {
    const source = next.handle();
    const Ctor = (source as { constructor?: unknown })?.constructor as ObservableCtor | undefined;
    if (typeof Ctor !== "function" || typeof source?.subscribe !== "function") return source;
    const options = this.options;
    return new Ctor((subscriber) => {
      const sub = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (err) => {
          captureNestException(err, context, options);
          subscriber.error(err);
        },
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }
}
