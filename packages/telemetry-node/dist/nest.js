import { trackError } from "@telemetry-tracker/core";
function httpStatusOf(error) {
    const getStatus = error?.getStatus;
    if (typeof getStatus !== "function")
        return undefined;
    try {
        const s = getStatus.call(error);
        return typeof s === "number" ? s : undefined;
    }
    catch {
        return undefined;
    }
}
function defaultShouldReport(error) {
    const status = httpStatusOf(error);
    return status === undefined || status >= 500;
}
function stripQuery(url) {
    const i = url.indexOf("?");
    return i === -1 ? url : url.slice(0, i);
}
function contextFor(host) {
    const ctx = { source: "nestjs" };
    if (!host)
        return ctx;
    try {
        const type = typeof host.getType === "function" ? host.getType() : undefined;
        if (type)
            ctx.nest_context = type;
        if ((type === undefined || type === "http") && typeof host.switchToHttp === "function") {
            const req = host.switchToHttp().getRequest();
            if (req) {
                if (req.method)
                    ctx.method = req.method;
                const url = req.originalUrl || req.url;
                if (url)
                    ctx.path = stripQuery(url);
            }
        }
        const cls = typeof host.getClass === "function" ? host.getClass()?.name : undefined;
        const fn = typeof host.getHandler === "function" ? host.getHandler()?.name : undefined;
        if (cls || fn)
            ctx.handler = [cls, fn].filter(Boolean).join(".");
    }
    catch {
        // context is best-effort
    }
    return ctx;
}
/**
 * Report an exception caught by Nest (e.g. from your own `@Catch()` filter). Never throws.
 * HTTP exceptions below 500 are skipped unless `shouldReport` says otherwise.
 */
export function captureNestException(error, host, options) {
    try {
        const should = options?.shouldReport ?? defaultShouldReport;
        if (!should(error))
            return;
        trackError(error, contextFor(host));
    }
    catch {
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
    constructor(options) {
        this.options = options;
    }
    // Generic so the instance satisfies Nest's `NestInterceptor` (returns rxjs `Observable`).
    intercept(context, next) {
        const source = next.handle();
        const Ctor = source?.constructor;
        if (typeof Ctor !== "function" || typeof source?.subscribe !== "function")
            return source;
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
