import { readDeviceContext } from "./device-context.js";
import { installWebVitals, setWebVitalsCaptureEnabled, WEB_VITAL_EVENT_NAME, } from "./web-vitals.js";
import { scrubPiiRecord, scrubPiiText } from "./pii-scrub.js";
import { SDK_VERSION } from "./version.js";
import { toReportableError } from "./to-reportable-error.js";
export { SDK_VERSION };
export { toReportableError } from "./to-reportable-error.js";
export { scrubPiiText, scrubPiiRecord } from "./pii-scrub.js";
export { WEB_VITAL_EVENT_NAME, installWebVitals, rateWebVital, buildWebVitalProperties, setWebVitalsCaptureEnabled, isWebVitalsCaptureEnabled, } from "./web-vitals.js";
const ANON_STORAGE_KEY = "tacko_telemetry_anon_id";
/** In-flight ingest promises so a later fatal flush can await trackError(e); throw e. */
const inFlightIngest = new WeakMap();
/** Completed error reports — WeakSet so we never mutate frozen/sealed Error objects. */
const reportedErrors = new WeakSet();
let anonymousId = null;
let fallbackIdSeq = 0;
function bytesToUuid(bytes) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Prefer Web Crypto; fall back for Node/RN hosts without a global crypto polyfill. */
function generateUUID() {
    const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (webCrypto && typeof webCrypto.randomUUID === "function") {
        return webCrypto.randomUUID();
    }
    if (webCrypto && typeof webCrypto.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        webCrypto.getRandomValues(bytes);
        return bytesToUuid(bytes);
    }
    // Constrained runtimes: unique analytics IDs without Math.random (CodeQL insecure-randomness).
    const bytes = new Uint8Array(16);
    let n = (Date.now() ^ (++fallbackIdSeq * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < 16; i++) {
        n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
        bytes[i] = n & 0xff;
    }
    return bytesToUuid(bytes);
}
export function getAnonymousId() {
    if (anonymousId)
        return anonymousId;
    if (typeof localStorage !== "undefined") {
        try {
            const stored = localStorage.getItem(ANON_STORAGE_KEY);
            if (stored) {
                anonymousId = stored;
                return anonymousId;
            }
        }
        catch (_) { }
    }
    anonymousId = generateUUID();
    if (typeof localStorage !== "undefined") {
        try {
            localStorage.setItem(ANON_STORAGE_KEY, anonymousId);
        }
        catch (_) { }
    }
    return anonymousId;
}
let config = null;
let userId = null;
let userEmail = null;
let browserHandlersInstalled = false;
let sessionLifecycleInstalled = false;
let sessionId = null;
let sessionStartedAt = null;
const DEFAULT_BATCH_INTERVAL = 5000;
const DEFAULT_BATCH_SIZE = 10;
const eventQueue = [];
let flushTimer = null;
function ensureUrlFromCfg(cfg, path) {
    const base = cfg.ingestUrl.replace(/\/$/, "");
    return `${base}${path}`;
}
function buildSessionPayload(cfg, endedAt) {
    const device = readDeviceContext();
    return {
        session_id: sessionId,
        app: cfg.app,
        platform: cfg.platform ?? undefined,
        environment: cfg.environment ?? undefined,
        release: cfg.release ?? undefined,
        user_id: userId ?? undefined,
        user_email: userEmail ?? undefined,
        anonymous_id: getAnonymousId(),
        sdk_version: SDK_VERSION,
        country: device.country ?? undefined,
        device_browser: device.device_browser ?? undefined,
        device_os: device.device_os ?? undefined,
        started_at: sessionStartedAt?.toISOString(),
        ended_at: endedAt?.toISOString(),
    };
}
async function postSession(cfg, endedAt) {
    if (!sessionId)
        return;
    try {
        const res = await fetch(ensureUrlFromCfg(cfg, "/ingest/session"), {
            method: "POST",
            headers: buildIngestHeaders(cfg),
            body: JSON.stringify(buildSessionPayload(cfg, endedAt)),
        });
        if (!res.ok) {
            console.warn("[telemetry] session ingest failed:", res.status, await res.text());
        }
    }
    catch (e) {
        console.warn("[telemetry] session send error:", e);
    }
}
function postSessionKeepalive(endedAt) {
    const cfg = getConfigOrNull();
    if (!cfg || !sessionId)
        return;
    try {
        void fetch(ensureUrlFromCfg(cfg, "/ingest/session"), {
            method: "POST",
            headers: buildIngestHeaders(cfg),
            body: JSON.stringify(buildSessionPayload(cfg, endedAt)),
            keepalive: true,
        });
    }
    catch (_) { }
}
/** End the current session via keepalive POST and clear in-memory session state. */
function closeSessionKeepalive(endedAt) {
    if (!sessionId)
        return;
    postSessionKeepalive(endedAt);
    sessionId = null;
    sessionStartedAt = null;
}
function startSession() {
    const cfg = getConfigOrNull();
    if (!cfg)
        return;
    sessionId = generateUUID();
    sessionStartedAt = new Date();
    void postSession(cfg);
}
function installBrowserSessionLifecycle() {
    if (sessionLifecycleInstalled)
        return;
    if (typeof window === "undefined" ||
        typeof window.addEventListener !== "function" ||
        typeof document === "undefined")
        return;
    sessionLifecycleInstalled = true;
    window.addEventListener("pagehide", (event) => {
        if (event.persisted)
            return;
        flushEventsKeepalive();
        closeSessionKeepalive(new Date());
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushEventsKeepalive();
        }
    });
    window.addEventListener("pageshow", (event) => {
        if (event.persisted)
            return;
        if (!sessionId) {
            startSession();
        }
    });
}
export function getSessionId() {
    return sessionId;
}
/** End the current session and clear the in-memory session id. */
export function endSession() {
    const cfg = getConfigOrNull();
    if (!cfg || !sessionId)
        return;
    const ended = new Date();
    void postSession(cfg, ended);
    sessionId = null;
    sessionStartedAt = null;
}
/** Only install in real browser environments; skip in React Native / Node even if `window` is polyfilled. */
function installBrowserErrorHandlers() {
    if (browserHandlersInstalled)
        return;
    if (typeof window === "undefined" ||
        typeof window.addEventListener !== "function")
        return;
    browserHandlersInstalled = true;
    window.onerror = (message, source, lineno, colno, error) => {
        const cfg = getConfigOrNull();
        if (!cfg)
            return false;
        const err = error && error instanceof Error
            ? error
            : new Error(typeof message === "string" ? message : String(message));
        trackError(err, {
            source: "window.onerror",
            filename: source,
            lineno,
            colno,
        });
        return false; // let other handlers run
    };
    window.addEventListener("unhandledrejection", (event) => {
        const cfg = getConfigOrNull();
        if (!cfg)
            return;
        const reason = event.reason;
        const err = reason instanceof Error ? reason : new Error(reason != null ? String(reason) : "Unhandled rejection");
        trackError(err, { source: "unhandledrejection" });
    });
}
export function init(c) {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    if (sessionId) {
        endSession();
    }
    config = { ...c };
    warnIfMissingApiKey(config);
    getAnonymousId(); // ensure anonymous id exists and is persisted (browser) or set in memory (Node)
    const interval = c.batchInterval ?? DEFAULT_BATCH_INTERVAL;
    if (interval > 0 && typeof setInterval !== "undefined") {
        flushTimer = setInterval(flushEvents, interval);
        const t = flushTimer;
        if (typeof t.unref === "function")
            t.unref();
    }
    installBrowserErrorHandlers();
    startSession();
    installBrowserSessionLifecycle();
    setWebVitalsCaptureEnabled(c.webVitals !== false);
    if (c.webVitals !== false) {
        installBrowserWebVitals();
    }
}
/**
 * Stop ingesting: flush/end session, clear config and batch timer.
 * Browser error and session listeners stay installed but no-op while config is unset.
 */
export function shutdown() {
    flushEvents();
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    endSession();
    config = null;
    setWebVitalsCaptureEnabled(false);
}
function installBrowserWebVitals() {
    installWebVitals((properties) => {
        trackEvent(WEB_VITAL_EVENT_NAME, properties);
    });
}
export function identify(id, traits) {
    userId = id;
    if (traits && "email" in traits) {
        userEmail = traits.email ?? null;
    }
    const cfg = getConfigOrNull();
    if (cfg && sessionId) {
        void postSession(cfg);
    }
}
function getConfig() {
    if (!config)
        throw new Error("telemetry-core: init() must be called first");
    return config;
}
function ensureUrl(url) {
    const base = getConfig().ingestUrl.replace(/\/$/, "");
    return `${base}${url}`;
}
/** Headers for ingest POST requests (Authorization + Content-Type). */
export function buildIngestHeaders(cfg) {
    const headers = { "Content-Type": "application/json" };
    const key = cfg.apiKey?.trim();
    if (key) {
        headers.Authorization = `Bearer ${key}`;
    }
    return headers;
}
function warnIfMissingApiKey(cfg) {
    if (cfg.apiKey?.trim())
        return;
    const env = cfg.environment?.toLowerCase();
    if (env === "development" || env === "dev" || env === "test")
        return;
    console.warn("[telemetry] apiKey is not set — ingest requests will fail unless the server allows unauthenticated ingest.");
}
async function send(path, body) {
    const cfg = getConfig();
    try {
        const res = await fetch(ensureUrl(path), {
            method: "POST",
            headers: buildIngestHeaders(cfg),
            body: JSON.stringify({
                ...body,
                app: cfg.app,
                platform: cfg.platform ?? undefined,
                environment: cfg.environment ?? undefined,
                release: cfg.release ?? undefined,
                anonymous_id: getAnonymousId(),
                sdk_version: SDK_VERSION,
            }),
        });
        if (!res.ok) {
            console.warn("[telemetry] ingest failed:", res.status, await res.text());
        }
    }
    catch (e) {
        console.warn("[telemetry] send error:", e);
    }
}
function flushEvents() {
    const cfg = getConfigOrNull();
    if (!cfg || eventQueue.length === 0)
        return;
    const batch = eventQueue.splice(0, eventQueue.length);
    sendEventBatch(cfg, batch, false);
}
/** Flush queued events with keepalive for tab hide / unload (CLS and short visits). */
function flushEventsKeepalive() {
    const cfg = getConfigOrNull();
    if (!cfg || eventQueue.length === 0)
        return;
    const batch = eventQueue.splice(0, eventQueue.length);
    sendEventBatch(cfg, batch, true);
}
function sendEventBatch(cfg, batch, keepalive) {
    const base = cfg.ingestUrl.replace(/\/$/, "");
    const anonId = getAnonymousId();
    const events = batch.map((e) => ({
        app: cfg.app,
        platform: cfg.platform,
        environment: cfg.environment,
        release: cfg.release,
        name: e.name,
        user_id: e.user_id ?? undefined,
        session_id: e.session_id,
        anonymous_id: anonId,
        sdk_version: SDK_VERSION,
        properties: e.properties,
    }));
    try {
        void fetch(`${base}/ingest/batch`, {
            method: "POST",
            headers: buildIngestHeaders(cfg),
            body: JSON.stringify({ events }),
            ...(keepalive ? { keepalive: true } : {}),
        }).catch((e) => console.warn("[telemetry] batch send error:", e));
    }
    catch (e) {
        console.warn("[telemetry] batch send error:", e);
    }
}
function resolveClientPiiScrub(cfg) {
    // Opt-in only: omitted / false / null → no client scrubbing.
    if (cfg?.piiScrub == null || cfg.piiScrub === false)
        return null;
    if (cfg.piiScrub === true)
        return {};
    if (typeof cfg.piiScrub === "object") {
        // `{ denyKeys: [] }` still enables default pattern/key scrubbing (no extra keys).
        return {
            ...(cfg.piiScrub.denyKeys && cfg.piiScrub.denyKeys.length > 0
                ? { denyKeys: cfg.piiScrub.denyKeys }
                : {}),
        };
    }
    return null;
}
/** @internal exported for tests */
export { resolveClientPiiScrub };
function scrubEventProperties(cfg, properties) {
    const opts = resolveClientPiiScrub(cfg);
    if (!opts || properties === undefined)
        return properties;
    return scrubPiiRecord(properties, opts);
}
export function trackEvent(name, properties) {
    const cfg = getConfigOrNull();
    const interval = cfg?.batchInterval ?? DEFAULT_BATCH_INTERVAL;
    const batchSize = cfg?.batchSize ?? DEFAULT_BATCH_SIZE;
    const scrubbedProperties = scrubEventProperties(cfg, properties ?? undefined);
    const item = {
        name,
        user_id: userId,
        session_id: sessionId ?? undefined,
        properties: scrubbedProperties,
    };
    if (interval > 0 && typeof setInterval !== "undefined") {
        eventQueue.push(item);
        if (eventQueue.length >= batchSize)
            flushEvents();
    }
    else {
        send("/ingest/event", {
            name: item.name,
            user_id: item.user_id ?? undefined,
            session_id: item.session_id,
            properties: item.properties,
        }).catch(() => { });
    }
}
export function trackError(error, context) {
    void ingestError(error, context);
}
/** Send an error and resolve after the ingest request settles. Fatal handlers await this. */
export function ingestError(error, context) {
    try {
        const cfg = getConfigOrNull();
        if (!cfg)
            return Promise.resolve();
        const err = toReportableError(error);
        const existing = inFlightIngest.get(err);
        if (existing)
            return existing;
        if (reportedErrors.has(err)) {
            return Promise.resolve();
        }
        let message = err.message;
        let stack = err.stack;
        let scrubbedContext = context ?? undefined;
        const scrubOpts = resolveClientPiiScrub(cfg);
        if (scrubOpts) {
            message = scrubPiiText(message);
            if (stack != null)
                stack = scrubPiiText(stack);
            if (scrubbedContext != null) {
                scrubbedContext = scrubPiiRecord(scrubbedContext, scrubOpts);
            }
        }
        // Non-mutating dedupe — safe for Object.freeze / seal / preventExtensions.
        reportedErrors.add(err);
        const pending = send("/ingest/error", {
            message,
            stack: stack ?? undefined,
            context: scrubbedContext,
            user_id: userId ?? undefined,
            session_id: sessionId ?? undefined,
        })
            .catch(() => { })
            .finally(() => {
            inFlightIngest.delete(err);
        });
        inFlightIngest.set(err, pending);
        return pending;
    }
    catch {
        // Never let telemetry-internal failures escape into the caller's crash path.
        return Promise.resolve();
    }
}
export function screen(name) {
    trackEvent("$screen", { name });
}
export function getUserId() {
    return userId;
}
export function getConfigOrNull() {
    return config;
}
