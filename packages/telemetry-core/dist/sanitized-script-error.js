/**
 * Browser-sanitized cross-origin "Script error." handling.
 *
 * When a script from another origin throws, browsers often invoke window.onerror
 * with message "Script error.", no Error object, empty filename, and line/col 0.
 * Fabricating `new Error("Script error.")` in that handler produces a misleading
 * stack that points at the SDK itself and defeats instance-based dedupe.
 */
/** Default rate-limit window for identical sanitized global errors. */
export const SANITIZED_GLOBAL_ERROR_DEDUPE_WINDOW_MS = 60000;
/** Max reports of the same sanitized key inside one dedupe window. */
export const SANITIZED_GLOBAL_ERROR_MAX_PER_WINDOW = 1;
const SCRIPT_ERROR_MESSAGES = new Set(["Script error.", "Script error"]);
export function createSanitizedGlobalErrorDedupeStore() {
    return { entries: new Map() };
}
/**
 * Classic sanitized Script error: no Error object and wiped location metadata.
 * Errors that include a real Error instance are never treated as sanitized.
 */
export function isSanitizedBrowserScriptError(message, filename, lineno, colno, error) {
    if (error != null && error instanceof Error) {
        return false;
    }
    if (typeof message !== "string") {
        return false;
    }
    const trimmed = message.trim();
    if (!SCRIPT_ERROR_MESSAGES.has(trimmed)) {
        return false;
    }
    const file = filename ?? "";
    const line = lineno ?? 0;
    const col = colno ?? 0;
    return file === "" && line === 0 && col === 0;
}
export function sanitizedGlobalErrorDedupeKey(message, filename, lineno, colno) {
    return `${message}\0${filename}\0${lineno}\0${colno}`;
}
/**
 * Returns true when this sanitized global error should be reported.
 * Identical keys are rate-limited within `windowMs` (default 60s, max 1).
 * After the window elapses, reporting is allowed again.
 */
export function shouldReportSanitizedGlobalError(store, key, nowMs, windowMs = SANITIZED_GLOBAL_ERROR_DEDUPE_WINDOW_MS, maxPerWindow = SANITIZED_GLOBAL_ERROR_MAX_PER_WINDOW) {
    const entry = store.entries.get(key);
    if (!entry || nowMs - entry.windowStartMs >= windowMs) {
        store.entries.set(key, { windowStartMs: nowMs, count: 1 });
        return true;
    }
    if (entry.count < maxPerWindow) {
        entry.count += 1;
        return true;
    }
    return false;
}
export function clearSanitizedGlobalErrorDedupe(store) {
    store.entries.clear();
}
/** Context fields attached to sanitized Script error ingest payloads. */
export function buildSanitizedScriptErrorContext(filename, lineno, colno) {
    return {
        source: "window.onerror",
        filename,
        lineno,
        colno,
        sanitized: true,
        browser_error: "sanitized_script_error",
    };
}
