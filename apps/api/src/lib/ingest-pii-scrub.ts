/**
 * Ingest-time PII scrubbing config and payload helpers.
 * Default: enabled. Self-hosters can disable with TELEMETRY_INGEST_PII_SCRUB=false.
 * Project denyKeys (Phase 2) merge into scrub options when provided.
 */

import {
  scrubPiiRecord,
  scrubPiiText,
  type PiiScrubOptions,
} from "./pii-scrub.js";

const MAX_TEXT_FIELD_BYTES = 16 * 1024;
const SCRUB_TIME_BUDGET_MS = 100;
const BUDGET_WARNING_THROTTLE_MS = 60_000;

let lastBudgetWarningMs = 0;
let suppressedWarningCount = 0;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Default on; set TELEMETRY_INGEST_PII_SCRUB=false|0|off to disable. */
export function isIngestPiiScrubEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env.TELEMETRY_INGEST_PII_SCRUB?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

export function resolveIngestPiiScrubOptions(
  env: NodeJS.ProcessEnv = process.env,
  extras?: { denyKeys?: string[] }
): PiiScrubOptions {
  return {
    maxDepth: parsePositiveInt(env.TELEMETRY_INGEST_PII_SCRUB_MAX_DEPTH, 8),
    maxNodes: parsePositiveInt(env.TELEMETRY_INGEST_PII_SCRUB_MAX_NODES, 500),
    ...(extras?.denyKeys && extras.denyKeys.length > 0
      ? { denyKeys: extras.denyKeys }
      : {}),
  };
}

function truncateString(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  const buf = Buffer.from(str, "utf8");
  let truncated = buf.subarray(0, maxBytes).toString("utf8");
  while (truncated.endsWith("\uFFFD") && truncated.length > 0) {
    const shortened = Buffer.from(truncated, "utf8");
    truncated = shortened.subarray(0, shortened.length - 1).toString("utf8");
  }
  return truncated;
}

function scrubPiiTextWithBudget(text: string, budgetMs: number): string {
  const start = Date.now();
  try {
    const result = scrubPiiText(text);
    const elapsed = Date.now() - start;
    if (elapsed > budgetMs) {
      const now = Date.now();
      if (now - lastBudgetWarningMs >= BUDGET_WARNING_THROTTLE_MS) {
        if (suppressedWarningCount > 0) {
          console.warn(
            `[scrub-budget] Text scrub took ${elapsed}ms (budget ${budgetMs}ms); ` +
            `${suppressedWarningCount} warning(s) suppressed in last ${BUDGET_WARNING_THROTTLE_MS / 1000}s`
          );
          suppressedWarningCount = 0;
        } else {
          console.warn(`[scrub-budget] Text scrub took ${elapsed}ms (budget ${budgetMs}ms)`);
        }
        lastBudgetWarningMs = now;
      } else {
        suppressedWarningCount += 1;
      }
    }
    return result;
  } catch (err) {
    const e = err as Error;
    console.error(`[scrub-budget] Scrub threw: ${e.name}: ${e.message}`);
    return "[scrub-error]";
  }
}

function scrubPiiRecordWithBudget(
  record: Record<string, unknown> | undefined,
  options: PiiScrubOptions,
  budgetMs: number
): Record<string, unknown> | undefined {
  if (record == null) return undefined;
  const start = Date.now();
  try {
    const result = scrubPiiRecord(record, options);
    const elapsed = Date.now() - start;
    if (elapsed > budgetMs) {
      const now = Date.now();
      if (now - lastBudgetWarningMs >= BUDGET_WARNING_THROTTLE_MS) {
        if (suppressedWarningCount > 0) {
          console.warn(
            `[scrub-budget] Record scrub took ${elapsed}ms (budget ${budgetMs}ms); ` +
            `${suppressedWarningCount} warning(s) suppressed in last ${BUDGET_WARNING_THROTTLE_MS / 1000}s`
          );
          suppressedWarningCount = 0;
        } else {
          console.warn(`[scrub-budget] Record scrub took ${elapsed}ms (budget ${budgetMs}ms)`);
        }
        lastBudgetWarningMs = now;
      } else {
        suppressedWarningCount += 1;
      }
    }
    return result;
  } catch (err) {
    const e = err as Error;
    console.error(`[scrub-budget] Record scrub threw: ${e.name}: ${e.message}`);
    return { error: "[scrub-error]" };
  }
}

export type IngestErrorFields = {
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

export type IngestEventFields = {
  properties?: Record<string, unknown>;
};

export type IngestScrubExtras = {
  denyKeys?: string[];
};

/** Scrub error message/stack/context before fingerprint + persistence. */
export function scrubIngestErrorFields<T extends IngestErrorFields>(
  body: T,
  env: NodeJS.ProcessEnv = process.env,
  extras?: IngestScrubExtras
): T {
  const truncatedMessage = truncateString(body.message, MAX_TEXT_FIELD_BYTES);
  const truncatedStack = body.stack !== undefined
    ? truncateString(body.stack, MAX_TEXT_FIELD_BYTES)
    : undefined;
  const truncatedContext = body.context !== undefined
    ? (truncateRecordStrings(body.context, MAX_TEXT_FIELD_BYTES, { n: 0 }) as Record<string, unknown>)
    : undefined;

  if (!isIngestPiiScrubEnabled(env)) {
    return {
      ...body,
      message: truncatedMessage,
      ...(truncatedStack !== undefined ? { stack: truncatedStack } : {}),
      ...(truncatedContext !== undefined ? { context: truncatedContext } : {}),
    };
  }

  const options = resolveIngestPiiScrubOptions(env, extras);
  return {
    ...body,
    message: scrubPiiTextWithBudget(truncatedMessage, SCRUB_TIME_BUDGET_MS),
    ...(truncatedStack !== undefined
      ? { stack: scrubPiiTextWithBudget(truncatedStack, SCRUB_TIME_BUDGET_MS) }
      : {}),
    ...(truncatedContext !== undefined
      ? { context: scrubPiiRecordWithBudget(truncatedContext, options, SCRUB_TIME_BUDGET_MS) }
      : {}),
  };
}

function truncateRecordStrings(
  value: unknown,
  maxBytes: number,
  nodeCount = { n: 0 }
): unknown {
  nodeCount.n += 1;
  if (nodeCount.n > 10_000) {
    return typeof value === "string" ? truncateString(value, maxBytes) : "[truncated]";
  }
  if (typeof value === "string") {
    return truncateString(value, maxBytes);
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateRecordStrings(item, maxBytes, nodeCount));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = truncateRecordStrings(child, maxBytes, nodeCount);
    }
    return out;
  }
  return value;
}

/** Scrub event properties before persistence. */
export function scrubIngestEventFields<T extends IngestEventFields>(
  body: T,
  env: NodeJS.ProcessEnv = process.env,
  extras?: IngestScrubExtras
): T {
  if (body.properties === undefined) return body;
  const truncated = truncateRecordStrings(
    body.properties,
    MAX_TEXT_FIELD_BYTES,
    { n: 0 }
  ) as Record<string, unknown>;

  if (!isIngestPiiScrubEnabled(env)) {
    return {
      ...body,
      properties: truncated,
    };
  }

  const options = resolveIngestPiiScrubOptions(env, extras);
  return {
    ...body,
    properties: scrubPiiRecordWithBudget(truncated, options, SCRUB_TIME_BUDGET_MS),
  };
}

/**
 * Apply project opt-in session email scrubbing.
 * When disabled (default), returns the value unchanged.
 * When enabled, non-empty values are stored as the stable placeholder `[email]`
 * (not null) so the column remains present for debugging without retaining PII.
 */
export function scrubIngestSessionUserEmail(
  userEmail: string | null | undefined,
  scrubSessionUserEmail: boolean,
  env: NodeJS.ProcessEnv = process.env
): string | null | undefined {
  if (userEmail === undefined) return undefined;
  if (userEmail === null) return null;
  if (!scrubSessionUserEmail || !isIngestPiiScrubEnabled(env)) {
    return userEmail;
  }
  const trimmed = userEmail.trim();
  if (!trimmed) return userEmail;
  return "[email]";
}
