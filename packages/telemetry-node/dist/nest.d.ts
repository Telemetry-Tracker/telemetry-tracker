/** Structural subset of Nest's `ExecutionContext` / `ArgumentsHost`. */
type NestContextLike = {
    getType?: () => string;
    switchToHttp?: () => {
        getRequest(): unknown;
    };
    getClass?: () => {
        name?: string;
    } | undefined;
    getHandler?: () => {
        name?: string;
    } | undefined;
};
export type TelemetryInterceptorOptions = {
    /**
     * Decide whether an exception is reported. Default: everything except HTTP exceptions with a
     * status below 500 (e.g. `NotFoundException`, validation `BadRequestException`).
     */
    shouldReport?: (error: unknown) => boolean;
};
/**
 * Report an exception caught by Nest (e.g. from your own `@Catch()` filter). Never throws.
 * HTTP exceptions below 500 are skipped unless `shouldReport` says otherwise.
 */
export declare function captureNestException(error: unknown, host?: NestContextLike, options?: TelemetryInterceptorOptions): void;
/**
 * Global Nest interceptor: reports exceptions thrown by controllers and the providers they call,
 * then rethrows them unchanged so Nest's exception filters build the same response as before.
 *
 * ```ts
 * app.useGlobalInterceptors(new TelemetryInterceptor());
 * ```
 */
export declare class TelemetryInterceptor {
    private readonly options;
    constructor(options?: TelemetryInterceptorOptions);
    intercept<T>(context: NestContextLike, next: {
        handle(): T;
    }): T;
}
export {};
