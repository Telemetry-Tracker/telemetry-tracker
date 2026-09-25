import { SDK_VERSION } from "./version.js";
export { SDK_VERSION };
export { scrubPiiText, scrubPiiRecord } from "./pii-scrub.js";
export { WEB_VITAL_EVENT_NAME, installWebVitals, rateWebVital, buildWebVitalProperties, setWebVitalsCaptureEnabled, isWebVitalsCaptureEnabled, type WebVitalEventProperties, type WebVitalMetricName, type WebVitalRating, } from "./web-vitals.js";
export declare function getAnonymousId(): string;
export type TelemetryPiiScrubConfig = boolean | {
    /** Extra property/context keys to redact (case-insensitive). */
    denyKeys?: string[];
};
export type TelemetryConfig = {
    ingestUrl: string;
    app: string;
    /** Project API key (`tt_live_<publicId>_<secret>`). Required in production ingest. */
    apiKey?: string;
    platform?: string;
    environment?: string;
    release?: string;
    /** Flush interval in ms. Default 5000. Set 0 to disable batching. */
    batchInterval?: number;
    /** Max queue size before flush. Default 10. */
    batchSize?: number;
    /** Capture Core Web Vitals (LCP, INP, CLS, TTFB) in browser. Default true. */
    webVitals?: boolean;
    /**
     * Optional client-side PII scrubbing before send (default off).
     * Complements server ingest scrubbing — never rely on this alone.
     * See https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/PII-SCRUBBING.md
     */
    piiScrub?: TelemetryPiiScrubConfig;
};
export declare function getSessionId(): string | null;
/** End the current session and clear the in-memory session id. */
export declare function endSession(): void;
export declare function init(c: TelemetryConfig): void;
/**
 * Stop ingesting: flush/end session, clear config and batch timer.
 * Browser error and session listeners stay installed but no-op while config is unset.
 */
export declare function shutdown(): void;
export type IdentifyTraits = {
    email?: string | null;
};
export declare function identify(id: string | null, traits?: IdentifyTraits): void;
/** Headers for ingest POST requests (Authorization + Content-Type). */
export declare function buildIngestHeaders(cfg: Pick<TelemetryConfig, "apiKey">): Record<string, string>;
declare function resolveClientPiiScrub(cfg: TelemetryConfig | null): {
    denyKeys?: string[];
} | null;
/** @internal exported for tests */
export { resolveClientPiiScrub };
export declare function trackEvent(name: string, properties?: Record<string, unknown>): void;
export declare function trackError(error: Error | {
    message: string;
    stack?: string;
}, context?: Record<string, unknown>): void;
/** Send an error and resolve after the ingest request settles. Fatal handlers await this. */
export declare function ingestError(error: Error | {
    message: string;
    stack?: string;
}, context?: Record<string, unknown>): Promise<void>;
export declare function screen(name: string): void;
export declare function getUserId(): string | null;
export declare function getConfigOrNull(): TelemetryConfig | null;
//# sourceMappingURL=index.d.ts.map