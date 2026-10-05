/**
 * Privacy filter for Sentry events. Keep in sync with
 * `apps/api/src/lib/sentry-privacy.ts`.
 *
 * This does not replace Telemetry Tracker's ingest PII scrubber.
 * The walk is in-place and cycle-safe. It does not use structuredClone.
 */

const TT_LIVE_API_KEY = /tt_live_[A-Za-z0-9_]+/g;

/**
 * Normal Sentry events are shallow (exception, request, breadcrumbs, a few
 * frames). These caps stop a pathological event from doing unbounded work.
 * Anything not visited is dropped, not left in place.
 */
export const SENTRY_EVENT_SANITIZE_MAX_DEPTH = 16;
export const SENTRY_EVENT_SANITIZE_MAX_NODES = 4000;

/** Header names removed entirely, compared case-insensitively. */
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "www-authenticate",
  "authentication",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-api-token",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-session-token",
  "x-session-id",
  "x-refresh-token",
]);

type JsonObject = Record<string, unknown>;

export type SentrySanitizeLimits = {
  maxDepth?: number;
  maxNodes?: number;
};

type Budget = {
  nodes: number;
  maxNodes: number;
  maxDepth: number;
  seen: WeakSet<object>;
};

function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(normalized)) return true;
  return (
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("api-key") ||
    normalized.includes("apikey") ||
    normalized.includes("session") ||
    normalized.includes("csrf") ||
    normalized.includes("xsrf")
  );
}

function redactTelemetryTrackerApiKeys(value: string): string {
  return value.replace(TT_LIVE_API_KEY, "[redacted]");
}

/** Drop the query string. The path, host, and scheme stay. */
function stripUrlQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return url;
  return url.slice(0, queryIndex);
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isRequestLike(value: JsonObject): boolean {
  return (
    "headers" in value ||
    "query_string" in value ||
    "cookies" in value ||
    ("url" in value && ("method" in value || "data" in value || "body" in value))
  );
}

function isUrlField(key: string): boolean {
  return key === "url" || key === "url.full";
}

function isQueryField(key: string): boolean {
  return key === "query_string" || key === "http.query" || key === "url.query";
}

function holdsUnscannedSecret(value: unknown): boolean {
  return typeof value === "string" || (value !== null && typeof value === "object");
}

function tryConsume(budget: Budget): boolean {
  if (budget.nodes >= budget.maxNodes) return false;
  budget.nodes += 1;
  return true;
}

/**
 * Remove children we will not inspect. Strings and objects can hide secrets.
 * Sensitive header, cookie, query, body, and user keys are removed even when
 * the value is a number or boolean, so a budget stop cannot keep them.
 */
function dropUnscannedEntries(record: JsonObject, keys: string[], from: number): void {
  for (let index = from; index < keys.length; index += 1) {
    const key = keys[index];
    if (
      holdsUnscannedSecret(record[key]) ||
      isSensitiveHeaderName(key) ||
      key === "cookies" ||
      key === "data" ||
      key === "body" ||
      key === "user" ||
      isQueryField(key)
    ) {
      delete record[key];
    }
  }
}

function sanitizeHeaders(headers: JsonObject, depth: number, budget: Budget): void {
  if (budget.seen.has(headers)) return;
  budget.seen.add(headers);
  const names = Object.keys(headers);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (isSensitiveHeaderName(name)) {
      delete headers[name];
      continue;
    }
    if (depth > budget.maxDepth || !tryConsume(budget)) {
      dropUnscannedEntries(headers, names, index);
      return;
    }
    const value = headers[name];
    if (typeof value === "string") {
      headers[name] = redactTelemetryTrackerApiKeys(value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      sanitizeContainer(value, depth, budget);
    }
  }
}

function sanitizeObject(record: JsonObject, depth: number, budget: Budget): void {
  if (budget.seen.has(record)) return;
  budget.seen.add(record);

  if (isRequestLike(record)) {
    delete record.data;
    delete record.body;
    delete record.query_string;
    delete record.query;
    delete record.cookies;
  }
  for (const key of Object.keys(record)) {
    if (
      SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ||
      key === "cookies" ||
      isQueryField(key)
    ) {
      delete record[key];
    }
  }

  if (!tryConsume(budget)) {
    dropUnscannedEntries(record, Object.keys(record), 0);
    return;
  }

  const keys = Object.keys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!(key in record)) continue;
    const child = record[key];
    const childDepth = depth + 1;
    if (childDepth > budget.maxDepth || budget.nodes >= budget.maxNodes) {
      dropUnscannedEntries(record, keys, index);
      return;
    }
    if (key === "headers" && isPlainObject(child)) {
      sanitizeHeaders(child, childDepth, budget);
      continue;
    }
    if (isUrlField(key) && typeof child === "string") {
      if (!tryConsume(budget)) {
        delete record[key];
        dropUnscannedEntries(record, keys, index + 1);
        return;
      }
      record[key] = redactTelemetryTrackerApiKeys(stripUrlQuery(child));
      continue;
    }
    if (typeof child === "string") {
      if (!tryConsume(budget)) {
        delete record[key];
        dropUnscannedEntries(record, keys, index + 1);
        return;
      }
      record[key] = redactTelemetryTrackerApiKeys(child);
      continue;
    }
    if (child !== null && typeof child === "object") {
      sanitizeContainer(child, childDepth, budget);
      continue;
    }
    if (!tryConsume(budget)) {
      dropUnscannedEntries(record, keys, index + 1);
      return;
    }
  }
}

function sanitizeArray(values: unknown[], depth: number, budget: Budget): void {
  if (budget.seen.has(values)) return;
  budget.seen.add(values);
  if (!tryConsume(budget)) {
    values.length = 0;
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    const childDepth = depth + 1;
    if (childDepth > budget.maxDepth || budget.nodes >= budget.maxNodes) {
      values.length = index;
      return;
    }
    const child = values[index];
    if (typeof child === "string") {
      if (!tryConsume(budget)) {
        values.length = index;
        return;
      }
      values[index] = redactTelemetryTrackerApiKeys(child);
      continue;
    }
    if (child !== null && typeof child === "object") {
      sanitizeContainer(child, childDepth, budget);
      continue;
    }
    if (!tryConsume(budget)) {
      values.length = index;
      return;
    }
  }
}

function sanitizeContainer(value: object, depth: number, budget: Budget): void {
  if (Array.isArray(value)) {
    sanitizeArray(value, depth, budget);
    return;
  }
  if (isPlainObject(value)) sanitizeObject(value, depth, budget);
}

/**
 * Remove auth material, cookies, query strings, request bodies, Sentry user
 * data, and `tt_live_*` API keys. Returns the event so exception reporting
 * continues.
 *
 * Past the depth or node budget, remaining strings and nested objects are
 * removed instead of kept unread. Numbers and booleans already counted can
 * stay. A repeated object reference is sanitized once.
 */
export function sanitizeSentryEvent<T>(event: T, limits?: SentrySanitizeLimits): T {
  if (!isPlainObject(event)) return event;
  const budget: Budget = {
    nodes: 0,
    maxNodes: limits?.maxNodes ?? SENTRY_EVENT_SANITIZE_MAX_NODES,
    maxDepth: limits?.maxDepth ?? SENTRY_EVENT_SANITIZE_MAX_DEPTH,
    seen: new WeakSet(),
  };
  delete event.user;
  sanitizeObject(event, 0, budget);
  return event;
}

/**
 * beforeSend entry point. Always returns the event (never null). If the full
 * walk throws (throwing getters, hostile Proxy), remove the highest-risk
 * fields with per-field try/catch and still return the event so reporting
 * continues.
 */
export function safeSanitizeSentryEvent<T>(event: T, limits?: SentrySanitizeLimits): T {
  try {
    return sanitizeSentryEvent(event, limits);
  } catch {
    failClosedSentryEvent(event);
    return event;
  }
}

function failClosedSentryEvent(event: unknown): void {
  if (!event || typeof event !== "object") return;
  const record = event as Record<string, unknown>;
  try {
    delete record.user;
  } catch {
    /* ignore */
  }
  try {
    const request = record.request;
    if (!request || typeof request !== "object" || Array.isArray(request)) return;
    const req = request as Record<string, unknown>;
    for (const key of ["data", "body", "cookies", "query_string", "query"] as const) {
      try {
        delete req[key];
      } catch {
        /* ignore */
      }
    }
    try {
      if (typeof req.url === "string") {
        const queryIndex = req.url.indexOf("?");
        if (queryIndex !== -1) {
          req.url = req.url.slice(0, queryIndex);
        }
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}
