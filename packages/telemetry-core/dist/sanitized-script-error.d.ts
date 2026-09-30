/**
 * Browser-sanitized cross-origin "Script error." handling.
 *
 * When a script from another origin throws, browsers often invoke window.onerror
 * with message "Script error.", no Error object, empty filename, and line/col 0.
 * Fabricating `new Error("Script error.")` in that handler produces a misleading
 * stack that points at the SDK itself and defeats instance-based dedupe.
 */
/** Default rate-limit window for identical sanitized global errors. */
export declare const SANITIZED_GLOBAL_ERROR_DEDUPE_WINDOW_MS = 60000;
/** Max reports of the same sanitized key inside one dedupe window. */
export declare const SANITIZED_GLOBAL_ERROR_MAX_PER_WINDOW = 1;
export type SanitizedGlobalErrorDedupeEntry = {
    windowStartMs: number;
    count: number;
};
export type SanitizedGlobalErrorDedupeStore = {
    entries: Map<string, SanitizedGlobalErrorDedupeEntry>;
};
export declare function createSanitizedGlobalErrorDedupeStore(): SanitizedGlobalErrorDedupeStore;
/**
 * Classic sanitized Script error: no Error object and wiped location metadata.
 * Errors that include a real Error instance are never treated as sanitized.
 */
export declare function isSanitizedBrowserScriptError(message: string | Event, filename?: string | null, lineno?: number | null, colno?: number | null, error?: Error | null): boolean;
export declare function sanitizedGlobalErrorDedupeKey(message: string, filename: string, lineno: number, colno: number): string;
/**
 * Returns true when this sanitized global error should be reported.
 * Identical keys are rate-limited within `windowMs` (default 60s, max 1).
 * After the window elapses, reporting is allowed again.
 */
export declare function shouldReportSanitizedGlobalError(store: SanitizedGlobalErrorDedupeStore, key: string, nowMs: number, windowMs?: number, maxPerWindow?: number): boolean;
export declare function clearSanitizedGlobalErrorDedupe(store: SanitizedGlobalErrorDedupeStore): void;
/** Context fields attached to sanitized Script error ingest payloads. */
export declare function buildSanitizedScriptErrorContext(filename: string, lineno: number, colno: number): Record<string, unknown>;
//# sourceMappingURL=sanitized-script-error.d.ts.map