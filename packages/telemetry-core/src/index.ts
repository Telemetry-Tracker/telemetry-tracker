import { readDeviceContext } from "./device-context.js";
import {
  installWebVitals,
  setWebVitalsCaptureEnabled,
  WEB_VITAL_EVENT_NAME,
  type WebVitalEventProperties,
} from "./web-vitals.js";
import { scrubPiiRecord, scrubPiiText } from "./pii-scrub.js";

import { SDK_VERSION } from "./version.js";
import { toReportableError } from "./to-reportable-error.js";

export { SDK_VERSION };
export { toReportableError } from "./to-reportable-error.js";
export { scrubPiiText, scrubPiiRecord } from "./pii-scrub.js";
export {
  WEB_VITAL_EVENT_NAME,
  installWebVitals,
  rateWebVital,
  buildWebVitalProperties,
  setWebVitalsCaptureEnabled,
  isWebVitalsCaptureEnabled,
  type WebVitalEventProperties,
  type WebVitalMetricName,
  type WebVitalRating,
} from "./web-vitals.js";

const REPORTED = Symbol.for("telemetry.reported");
/** In-flight ingest promises so a later fatal flush can await trackError(e); throw e. */
const inFlightIngest = new WeakMap<object, Promise<void>>();

const ANON_STORAGE_KEY = "tacko_telemetry_anon_id";

let anonymousId: string | null = null;

let fallbackIdSeq = 0;

function bytesToUuid(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Prefer Web Crypto; fall back for Node/RN hosts without a global crypto polyfill. */
function generateUUID(): string {
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

export function getAnonymousId(): string {
  if (anonymousId) return anonymousId;
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(ANON_STORAGE_KEY);
      if (stored) {
        anonymousId = stored;
        return anonymousId;
      }
    } catch (_) {}
  }
  anonymousId = generateUUID();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(ANON_STORAGE_KEY, anonymousId);
    } catch (_) {}
  }
  return anonymousId;
}

export type TelemetryPiiScrubConfig =
  | boolean
  | {
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

let config: TelemetryConfig | null = null;
let userId: string | null = null;
let userEmail: string | null = null;
let browserHandlersInstalled = false;
let sessionLifecycleInstalled = false;
let sessionId: string | null = null;
let sessionStartedAt: Date | null = null;

const DEFAULT_BATCH_INTERVAL = 5000;
const DEFAULT_BATCH_SIZE = 10;

type QueuedEvent = {
  name: string;
  user_id: string | null;
  session_id: string | undefined;
  properties?: Record<string, unknown>;
};
const eventQueue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureUrlFromCfg(cfg: TelemetryConfig, path: string): string {
  const base = cfg.ingestUrl.replace(/\/$/, "");
  return `${base}${path}`;
}

function buildSessionPayload(cfg: TelemetryConfig, endedAt?: Date): Record<string, unknown> {
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

async function postSession(cfg: TelemetryConfig, endedAt?: Date): Promise<void> {
  if (!sessionId) return;
  try {
    const res = await fetch(ensureUrlFromCfg(cfg, "/ingest/session"), {
      method: "POST",
      headers: buildIngestHeaders(cfg),
      body: JSON.stringify(buildSessionPayload(cfg, endedAt)),
    });
    if (!res.ok) {
      console.warn("[telemetry] session ingest failed:", res.status, await res.text());
    }
  } catch (e) {
    console.warn("[telemetry] session send error:", e);
  }
}

function postSessionKeepalive(endedAt: Date): void {
  const cfg = getConfigOrNull();
  if (!cfg || !sessionId) return;
  try {
    void fetch(ensureUrlFromCfg(cfg, "/ingest/session"), {
      method: "POST",
      headers: buildIngestHeaders(cfg),
      body: JSON.stringify(buildSessionPayload(cfg, endedAt)),
      keepalive: true,
    });
  } catch (_) {}
}

/** End the current session via keepalive POST and clear in-memory session state. */
function closeSessionKeepalive(endedAt: Date): void {
  if (!sessionId) return;
  postSessionKeepalive(endedAt);
  sessionId = null;
  sessionStartedAt = null;
}

function startSession(): void {
  const cfg = getConfigOrNull();
  if (!cfg) return;
  sessionId = generateUUID();
  sessionStartedAt = new Date();
  void postSession(cfg);
}

function installBrowserSessionLifecycle(): void {
  if (sessionLifecycleInstalled) return;
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof document === "undefined"
  )
    return;
  sessionLifecycleInstalled = true;

  window.addEventListener("pagehide", (event: Event) => {
    if ((event as PageTransitionEvent).persisted) return;
    flushEventsKeepalive();
    closeSessionKeepalive(new Date());
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushEventsKeepalive();
    }
  });

  window.addEventListener("pageshow", (event: Event) => {
    if ((event as PageTransitionEvent).persisted) return;
    if (!sessionId) {
      startSession();
    }
  });
}

export function getSessionId(): string | null {
  return sessionId;
}

/** End the current session and clear the in-memory session id. */
export function endSession(): void {
  const cfg = getConfigOrNull();
  if (!cfg || !sessionId) return;
  const ended = new Date();
  void postSession(cfg, ended);
  sessionId = null;
  sessionStartedAt = null;
}

/** Only install in real browser environments; skip in React Native / Node even if `window` is polyfilled. */
function installBrowserErrorHandlers(): void {
  if (browserHandlersInstalled) return;
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  )
    return;
  browserHandlersInstalled = true;

  window.onerror = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error
  ): boolean => {
    const cfg = getConfigOrNull();
    if (!cfg) return false;
    const err =
      error && error instanceof Error
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

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent): void => {
    const cfg = getConfigOrNull();
    if (!cfg) return;
    const reason = event.reason;
    const err =
      reason instanceof Error ? reason : new Error(reason != null ? String(reason) : "Unhandled rejection");
    trackError(err, { source: "unhandledrejection" });
  });
}

export function init(c: TelemetryConfig): void {
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
    const t = flushTimer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
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
export function shutdown(): void {
  flushEvents();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  endSession();
  config = null;
  setWebVitalsCaptureEnabled(false);
}

function installBrowserWebVitals(): void {
  installWebVitals((properties: WebVitalEventProperties) => {
    trackEvent(WEB_VITAL_EVENT_NAME, properties);
  });
}

export type IdentifyTraits = {
  email?: string | null;
};

export function identify(id: string | null, traits?: IdentifyTraits): void {
  userId = id;
  if (traits && "email" in traits) {
    userEmail = traits.email ?? null;
  }
  const cfg = getConfigOrNull();
  if (cfg && sessionId) {
    void postSession(cfg);
  }
}

function getConfig(): TelemetryConfig {
  if (!config) throw new Error("telemetry-core: init() must be called first");
  return config;
}

function ensureUrl(url: string): string {
  const base = getConfig().ingestUrl.replace(/\/$/, "");
  return `${base}${url}`;
}

/** Headers for ingest POST requests (Authorization + Content-Type). */
export function buildIngestHeaders(cfg: Pick<TelemetryConfig, "apiKey">): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = cfg.apiKey?.trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function warnIfMissingApiKey(cfg: TelemetryConfig): void {
  if (cfg.apiKey?.trim()) return;
  const env = cfg.environment?.toLowerCase();
  if (env === "development" || env === "dev" || env === "test") return;
  console.warn(
    "[telemetry] apiKey is not set — ingest requests will fail unless the server allows unauthenticated ingest."
  );
}

async function send(path: string, body: Record<string, unknown>): Promise<void> {
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
  } catch (e) {
    console.warn("[telemetry] send error:", e);
  }
}

function flushEvents(): void {
  const cfg = getConfigOrNull();
  if (!cfg || eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, eventQueue.length);
  sendEventBatch(cfg, batch, false);
}

/** Flush queued events with keepalive for tab hide / unload (CLS and short visits). */
function flushEventsKeepalive(): void {
  const cfg = getConfigOrNull();
  if (!cfg || eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, eventQueue.length);
  sendEventBatch(cfg, batch, true);
}

function sendEventBatch(cfg: TelemetryConfig, batch: QueuedEvent[], keepalive: boolean): void {
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
  } catch (e) {
    console.warn("[telemetry] batch send error:", e);
  }
}

function resolveClientPiiScrub(
  cfg: TelemetryConfig | null
): { denyKeys?: string[] } | null {
  // Opt-in only: omitted / false / null → no client scrubbing.
  if (cfg?.piiScrub == null || cfg.piiScrub === false) return null;
  if (cfg.piiScrub === true) return {};
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

function scrubEventProperties(
  cfg: TelemetryConfig | null,
  properties: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const opts = resolveClientPiiScrub(cfg);
  if (!opts || properties === undefined) return properties;
  return scrubPiiRecord(properties, opts);
}

export function trackEvent(
  name: string,
  properties?: Record<string, unknown>
): void {
  const cfg = getConfigOrNull();
  const interval = cfg?.batchInterval ?? DEFAULT_BATCH_INTERVAL;
  const batchSize = cfg?.batchSize ?? DEFAULT_BATCH_SIZE;
  const scrubbedProperties = scrubEventProperties(cfg, properties ?? undefined);
  const item: QueuedEvent = {
    name,
    user_id: userId,
    session_id: sessionId ?? undefined,
    properties: scrubbedProperties,
  };
  if (interval > 0 && typeof setInterval !== "undefined") {
    eventQueue.push(item);
    if (eventQueue.length >= batchSize) flushEvents();
  } else {
    send("/ingest/event", {
      name: item.name,
      user_id: item.user_id ?? undefined,
      session_id: item.session_id,
      properties: item.properties,
    }).catch(() => {});
  }
}

export function trackError(
  error: unknown,
  context?: Record<string, unknown>
): void {
  void ingestError(error, context);
}

/** Send an error and resolve after the ingest request settles. Fatal handlers await this. */
export function ingestError(
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const cfg = getConfigOrNull();
  if (!cfg) return Promise.resolve();

  const err = toReportableError(error);

  const existing = inFlightIngest.get(err);
  if (existing) return existing;

  if ((err as unknown as Record<symbol, boolean>)[REPORTED]) {
    return Promise.resolve();
  }

  let message = err.message;
  let stack = err.stack;
  let scrubbedContext = context ?? undefined;
  const scrubOpts = resolveClientPiiScrub(cfg);
  if (scrubOpts) {
    message = scrubPiiText(message);
    if (stack != null) stack = scrubPiiText(stack);
    if (scrubbedContext != null) {
      scrubbedContext = scrubPiiRecord(scrubbedContext, scrubOpts);
    }
  }

  (err as unknown as Record<symbol, boolean>)[REPORTED] = true;

  const pending = send("/ingest/error", {
    message,
    stack: stack ?? undefined,
    context: scrubbedContext,
    user_id: userId ?? undefined,
    session_id: sessionId ?? undefined,
  })
    .catch(() => {})
    .finally(() => {
      inFlightIngest.delete(err);
    });

  inFlightIngest.set(err, pending);
  return pending;
}

export function screen(name: string): void {
  trackEvent("$screen", { name });
}

export function getUserId(): string | null {
  return userId;
}

export function getConfigOrNull(): TelemetryConfig | null {
  return config;
}
