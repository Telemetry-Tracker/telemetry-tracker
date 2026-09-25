/**
 * Configurable alert rules (#493 / #534 / #535).
 *
 * Separation of concerns:
 * - Alert Rules own Condition[] (AND) + opaque destinationIds + cooldown.
 * - Notifications (v1.14) own delivery — rules only call fireProjectAlert / enqueue paths.
 * - destinationIds are opaque bindings (well-known "project-email" or ProjectWebhook ids);
 *   providers (Slack/Discord/…) are resolved by Notifications, not stored as rule enums.
 * - Built-in spike/quota are SYSTEM AlertRule rows (#535); custom CRUD/evaluators skip them.
 *   Built-in evaluators keep legacy AlertEvent.rule + dedupe keys via fireProjectAlert.
 *
 * Evaluation paths:
 * - Ingest-triggered (`maybeEvaluateAlertRules`) for error-driven conditions.
 * - Scheduled (`runScheduledAlertRuleEvaluation`) for conditions that are not
 *   naturally ingest-triggered (HEARTBEAT, NO_EVENTS, SESSION_DROP, QUOTA_PERCENT).
 * Both paths share the same AND evaluator, last_fired_at cooldown claim, and delivery boundary.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  fireProjectAlert,
  type AlertFireDestinations,
} from "./alert-dispatch.js";

export const MAX_ALERT_RULES = 20;
export const MAX_CONDITIONS_PER_RULE = 8;
export const MAX_DESTINATIONS_PER_RULE = 20;

/**
 * Recommended cadence for the scheduled alert-rules evaluator (minutes).
 * Single source of truth for docs, Railway cron, and the optional loop worker.
 */
export const ALERT_RULES_SCHEDULE_INTERVAL_MINUTES = 5;

/**
 * Opaque destination id for project alert email fan-out.
 * Resolved by Notifications via fireProjectAlert — not a provider enum on the rule.
 */
export const PROJECT_EMAIL_DESTINATION_ID = "project-email";

const windowMinutesSchema = z.number().int().min(5).max(24 * 60);
const thresholdSchema = z.number().int().min(1).max(10_000);
const percentSchema = z.number().int().min(1).max(100);
const environmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v));

export type ErrorCountCondition = {
  type: "ERROR_COUNT";
  /** Minimum error occurrences in the window to fire. */
  threshold: number;
  windowMinutes: number;
  /** When set, only count occurrences with this environment at ingest time. */
  environment: string | null;
};

export type ErrorRateCondition = {
  type: "ERROR_RATE";
  /** Minimum error-rate percent (errors / sessions × 100) in the window. */
  thresholdPercent: number;
  windowMinutes: number;
  environment: string | null;
};

export type SessionDropCondition = {
  type: "SESSION_DROP";
  /** Minimum percent drop vs the previous equal-length window. */
  dropPercent: number;
  windowMinutes: number;
  environment: string | null;
};

export type NewErrorGroupCondition = {
  type: "NEW_ERROR_GROUP";
  /** Look back window for ErrorGroup.first_seen. */
  windowMinutes: number;
  environment: string | null;
};

export type AffectedUsersCondition = {
  type: "AFFECTED_USERS";
  /** Minimum distinct non-null user_id values on error occurrences. */
  threshold: number;
  windowMinutes: number;
  environment: string | null;
};

export type QuotaPercentCondition = {
  type: "QUOTA_PERCENT";
  /** Minimum monthly ingest usage percent of plan limit. */
  thresholdPercent: number;
};

export type NoEventsCondition = {
  type: "NO_EVENTS";
  /** Fire when zero events were received in this window. */
  windowMinutes: number;
  environment: string | null;
};

export type HeartbeatCondition = {
  type: "HEARTBEAT";
  /** Fire when no events, sessions, or error occurrences arrived in this window. */
  windowMinutes: number;
  environment: string | null;
};

/** Discriminated condition union — add kinds as evaluators ship. */
export type AlertRuleCondition =
  | ErrorCountCondition
  | ErrorRateCondition
  | SessionDropCondition
  | NewErrorGroupCondition
  | AffectedUsersCondition
  | QuotaPercentCondition
  | NoEventsCondition
  | HeartbeatCondition;

export type AlertRuleConditionType = AlertRuleCondition["type"];

/** Condition types evaluated on error ingest. */
export const INGEST_CONDITION_TYPES = new Set<AlertRuleConditionType>([
  "ERROR_COUNT",
  "ERROR_RATE",
  "NEW_ERROR_GROUP",
  "AFFECTED_USERS",
]);

/** Condition types that require the scheduled evaluator (not naturally ingest-triggered). */
export const SCHEDULED_CONDITION_TYPES = new Set<AlertRuleConditionType>([
  "HEARTBEAT",
  "NO_EVENTS",
  "SESSION_DROP",
  "QUOTA_PERCENT",
  "ERROR_RATE",
]);

export type AlertRulePublic = {
  id: string;
  name: string;
  enabled: boolean;
  /** AND semantics: every known condition must match (unknown types are skipped). */
  conditions: AlertRuleCondition[];
  /** Opaque destination ids (Notifications resolves providers). */
  destinationIds: string[];
  cooldownMinutes: number;
  createdAt: string;
  updatedAt: string;
};

const errorCountConditionSchema = z.object({
  type: z.literal("ERROR_COUNT"),
  threshold: thresholdSchema,
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const errorRateConditionSchema = z.object({
  type: z.literal("ERROR_RATE"),
  thresholdPercent: percentSchema,
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const sessionDropConditionSchema = z.object({
  type: z.literal("SESSION_DROP"),
  dropPercent: percentSchema,
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const newErrorGroupConditionSchema = z.object({
  type: z.literal("NEW_ERROR_GROUP"),
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const affectedUsersConditionSchema = z.object({
  type: z.literal("AFFECTED_USERS"),
  threshold: thresholdSchema,
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const quotaPercentConditionSchema = z.object({
  type: z.literal("QUOTA_PERCENT"),
  thresholdPercent: percentSchema,
});

const noEventsConditionSchema = z.object({
  type: z.literal("NO_EVENTS"),
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const heartbeatConditionSchema = z.object({
  type: z.literal("HEARTBEAT"),
  windowMinutes: windowMinutesSchema,
  environment: environmentSchema,
});

const conditionSchema = z.discriminatedUnion("type", [
  errorCountConditionSchema,
  errorRateConditionSchema,
  sessionDropConditionSchema,
  newErrorGroupConditionSchema,
  affectedUsersConditionSchema,
  quotaPercentConditionSchema,
  noEventsConditionSchema,
  heartbeatConditionSchema,
]);

const conditionsSchema = z
  .array(conditionSchema)
  .min(1)
  .max(MAX_CONDITIONS_PER_RULE);

const destinationIdSchema = z.union([
  z.literal(PROJECT_EMAIL_DESTINATION_ID),
  z.string().uuid(),
]);

const destinationIdsSchema = z
  .array(destinationIdSchema)
  .max(MAX_DESTINATIONS_PER_RULE)
  .transform((ids) => [...new Set(ids)]);

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  conditions: conditionsSchema,
  destinationIds: destinationIdsSchema,
  cooldownMinutes: z.number().int().min(5).max(24 * 60).optional().default(15),
});

const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    conditions: conditionsSchema.optional(),
    destinationIds: destinationIdsSchema.optional(),
    cooldownMinutes: z.number().int().min(5).max(24 * 60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Empty patch" });

/** Map opaque destinationIds → fireProjectAlert destination filters (Notifications boundary). */
export function resolveDestinationIds(
  destinationIds: string[]
): AlertFireDestinations {
  const unique = [...new Set(destinationIds)];
  return {
    email: unique.includes(PROJECT_EMAIL_DESTINATION_ID),
    webhookIds: unique.filter((id) => id !== PROJECT_EMAIL_DESTINATION_ID),
  };
}

export function resolveAlertRulesScheduleIntervalMinutes(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.ALERT_RULES_SCHEDULE_INTERVAL_MINUTES;
  if (raw === undefined || raw === "") return ALERT_RULES_SCHEDULE_INTERVAL_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 24 * 60) {
    return ALERT_RULES_SCHEDULE_INTERVAL_MINUTES;
  }
  return Math.trunc(n);
}

function normalizeCondition(
  c: z.infer<typeof conditionSchema>
): AlertRuleCondition {
  switch (c.type) {
    case "ERROR_COUNT":
      return {
        type: "ERROR_COUNT",
        threshold: c.threshold,
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    case "ERROR_RATE":
      return {
        type: "ERROR_RATE",
        thresholdPercent: c.thresholdPercent,
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    case "SESSION_DROP":
      return {
        type: "SESSION_DROP",
        dropPercent: c.dropPercent,
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    case "NEW_ERROR_GROUP":
      return {
        type: "NEW_ERROR_GROUP",
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    case "AFFECTED_USERS":
      return {
        type: "AFFECTED_USERS",
        threshold: c.threshold,
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    case "QUOTA_PERCENT":
      return {
        type: "QUOTA_PERCENT",
        thresholdPercent: c.thresholdPercent,
      };
    case "NO_EVENTS":
      return {
        type: "NO_EVENTS",
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    case "HEARTBEAT":
      return {
        type: "HEARTBEAT",
        windowMinutes: c.windowMinutes,
        environment: c.environment ?? null,
      };
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

/**
 * Parse stored condition JSON per-item.
 * Unknown / unsupported types are skipped (never crash AND evaluation).
 */
export function parseStoredConditions(raw: unknown): {
  conditions: AlertRuleCondition[];
  skippedUnknown: number;
} {
  if (!Array.isArray(raw)) {
    return { conditions: [], skippedUnknown: 0 };
  }
  const conditions: AlertRuleCondition[] = [];
  let skippedUnknown = 0;
  for (const item of raw.slice(0, MAX_CONDITIONS_PER_RULE)) {
    const parsed = conditionSchema.safeParse(item);
    if (parsed.success) {
      conditions.push(normalizeCondition(parsed.data));
      continue;
    }
    skippedUnknown += 1;
    const type =
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      typeof (item as { type: unknown }).type === "string"
        ? (item as { type: string }).type
        : "invalid";
    console.warn(
      `[alert-rules] skipping unknown/unsupported condition type=${type}`
    );
  }
  return { conditions, skippedUnknown };
}

function toPublic(row: {
  id: string;
  name: string;
  enabled: boolean;
  conditions: unknown;
  destination_ids: unknown;
  cooldown_minutes: number;
  created_at: Date;
  updated_at: Date;
}): AlertRulePublic {
  const { conditions } = parseStoredConditions(row.conditions);
  const destinationIdsParsed = destinationIdsSchema.safeParse(row.destination_ids);
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    conditions,
    destinationIds: destinationIdsParsed.success ? destinationIdsParsed.data : [],
    cooldownMinutes: row.cooldown_minutes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function webhookIdsFromDestinationIds(destinationIds: string[]): string[] {
  return [
    ...new Set(
      destinationIds.filter((id) => id !== PROJECT_EMAIL_DESTINATION_ID)
    ),
  ];
}

async function assertWebhookDestinationIdsBelongToProject(
  prisma: PrismaClient | Prisma.TransactionClient,
  projectId: string,
  destinationIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const webhookIds = webhookIdsFromDestinationIds(destinationIds);
  if (webhookIds.length === 0) return { ok: true };
  const found = await prisma.projectWebhook.count({
    where: {
      project_id: projectId,
      deleted_at: null,
      id: { in: webhookIds },
    },
  });
  if (found !== webhookIds.length) {
    return { ok: false, error: "One or more destinations were not found" };
  }
  return { ok: true };
}

export async function listAlertRules(
  prisma: PrismaClient,
  projectId: string
): Promise<AlertRulePublic[]> {
  // SYSTEM built-in rows are managed via alert-settings — exclude from custom CRUD list.
  const rows = await prisma.alertRule.findMany({
    where: { project_id: projectId, deleted_at: null, source: "CUSTOM" },
    orderBy: { created_at: "desc" },
  });
  return rows.map(toPublic);
}

export async function createAlertRule(
  prisma: PrismaClient,
  projectId: string,
  body: unknown
): Promise<
  | { ok: true; rule: AlertRulePublic }
  | { ok: false; error: string; status: 400 | 404 | 409 }
> {
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Invalid alert rule payload", status: 400 };
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, error: "Project not found", status: 404 };
  }

  const destCheck = await assertWebhookDestinationIdsBelongToProject(
    prisma,
    projectId,
    parsed.data.destinationIds
  );
  if (!destCheck.ok) {
    return { ok: false, error: destCheck.error, status: 400 };
  }

  const conditions = parsed.data.conditions.map(normalizeCondition);

  try {
    const row = await prisma.$transaction(
      async (tx) => {
        const count = await tx.alertRule.count({
          where: { project_id: projectId, deleted_at: null, source: "CUSTOM" },
        });
        if (count >= MAX_ALERT_RULES) {
          const err = new Error("MAX_ALERT_RULES") as Error & { code: string };
          err.code = "MAX_ALERT_RULES";
          throw err;
        }
        return tx.alertRule.create({
          data: {
            id: randomUUID(),
            project_id: projectId,
            name: parsed.data.name,
            enabled: parsed.data.enabled,
            source: "CUSTOM",
            conditions,
            destination_ids: parsed.data.destinationIds,
            cooldown_minutes: parsed.data.cooldownMinutes,
          },
        });
      },
      { isolationLevel: "Serializable" }
    );
    return { ok: true, rule: toPublic(row) };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "MAX_ALERT_RULES"
    ) {
      return {
        ok: false,
        error: `At most ${MAX_ALERT_RULES} alert rules per project`,
        status: 409,
      };
    }
    throw e;
  }
}

export async function updateAlertRule(
  prisma: PrismaClient,
  projectId: string,
  ruleId: string,
  body: unknown
): Promise<
  | { ok: true; rule: AlertRulePublic }
  | { ok: false; error: string; status: 400 | 403 | 404 }
> {
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Invalid alert rule patch", status: 400 };
  }

  const existing = await prisma.alertRule.findFirst({
    where: { id: ruleId, project_id: projectId, deleted_at: null },
  });
  if (!existing) {
    return { ok: false, error: "Alert rule not found", status: 404 };
  }
  if (existing.source === "SYSTEM") {
    return {
      ok: false,
      error: "System-managed alert rules are edited via project alert settings",
      status: 403,
    };
  }

  if (parsed.data.destinationIds) {
    const destCheck = await assertWebhookDestinationIdsBelongToProject(
      prisma,
      projectId,
      parsed.data.destinationIds
    );
    if (!destCheck.ok) {
      return { ok: false, error: destCheck.error, status: 400 };
    }
  }

  const data: Prisma.AlertRuleUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (parsed.data.cooldownMinutes !== undefined) {
    data.cooldown_minutes = parsed.data.cooldownMinutes;
  }
  if (parsed.data.conditions !== undefined) {
    data.conditions = parsed.data.conditions.map(normalizeCondition);
  }
  if (parsed.data.destinationIds !== undefined) {
    data.destination_ids = parsed.data.destinationIds;
  }

  const row = await prisma.alertRule.update({
    where: { id: ruleId },
    data,
  });
  return { ok: true, rule: toPublic(row) };
}

export async function softDeleteAlertRule(
  prisma: PrismaClient,
  projectId: string,
  ruleId: string
): Promise<
  | { ok: true }
  | { ok: false; error: string; status: 403 | 404 }
> {
  const existing = await prisma.alertRule.findFirst({
    where: { id: ruleId, project_id: projectId, deleted_at: null },
    select: { id: true, source: true },
  });
  if (!existing) {
    return { ok: false, error: "Alert rule not found", status: 404 };
  }
  if (existing.source === "SYSTEM") {
    return {
      ok: false,
      error: "System-managed alert rules cannot be deleted",
      status: 403,
    };
  }

  const result = await prisma.alertRule.updateMany({
    where: { id: ruleId, project_id: projectId, deleted_at: null, source: "CUSTOM" },
    data: { deleted_at: new Date(), enabled: false },
  });
  if (result.count === 0) {
    return { ok: false, error: "Alert rule not found", status: 404 };
  }
  return { ok: true };
}

/**
 * Drop a deleted webhook destination id from every live rule so bindings stay honest.
 */
export async function pruneDestinationIdFromAlertRules(
  prisma: PrismaClient | Prisma.TransactionClient,
  projectId: string,
  destinationId: string
): Promise<number> {
  if (destinationId === PROJECT_EMAIL_DESTINATION_ID) return 0;
  const rules = await prisma.alertRule.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, destination_ids: true, source: true },
  });
  let updated = 0;
  for (const rule of rules) {
    // SYSTEM rows use a destination placeholder; do not mutate them here.
    if (rule.source === "SYSTEM") continue;
    const parsed = destinationIdsSchema.safeParse(rule.destination_ids);
    if (!parsed.success) continue;
    if (!parsed.data.includes(destinationId)) continue;
    const destinationIds = parsed.data.filter((id) => id !== destinationId);
    await prisma.alertRule.update({
      where: { id: rule.id },
      data: { destination_ids: destinationIds },
    });
    updated += 1;
  }
  return updated;
}

/**
 * Idempotency key for AlertEvent after a successful cooldown claim.
 * Unique per claim timestamp — cooldown itself is enforced via last_fired_at.
 */
export function alertRuleDedupeKey(ruleId: string, claimedAtMs: number): string {
  return `alert:rule:${ruleId}:${claimedAtMs}`;
}

/**
 * Atomically claim the right to fire a rule when cooldown has elapsed since
 * last_fired_at. Concurrent evaluators racing the same rule: at most one wins.
 * Returns the claim timestamp on success, null when still in cooldown.
 */
export async function tryClaimAlertRuleFire(
  prisma: PrismaClient,
  ruleId: string,
  cooldownMinutes: number,
  now = new Date()
): Promise<Date | null> {
  const cutoff = new Date(now.getTime() - cooldownMinutes * 60 * 1000);
  const result = await prisma.alertRule.updateMany({
    where: {
      id: ruleId,
      deleted_at: null,
      OR: [{ last_fired_at: null }, { last_fired_at: { lte: cutoff } }],
    },
    data: { last_fired_at: now },
  });
  return result.count === 1 ? now : null;
}

/** Undo a claim when fireProjectAlert throws before durable enqueue. */
async function releaseAlertRuleFireClaim(
  prisma: PrismaClient,
  ruleId: string,
  claimedAt: Date
): Promise<void> {
  await prisma.alertRule.updateMany({
    where: { id: ruleId, last_fired_at: claimedAt },
    data: { last_fired_at: null },
  });
}

export function ruleNeedsIngestEvaluation(rule: AlertRulePublic): boolean {
  return rule.conditions.some((c) => INGEST_CONDITION_TYPES.has(c.type));
}

export function ruleNeedsScheduledEvaluation(rule: AlertRulePublic): boolean {
  return rule.conditions.some((c) => SCHEDULED_CONDITION_TYPES.has(c.type));
}

function windowSince(windowMinutes: number, now = Date.now()): Date {
  return new Date(now - windowMinutes * 60 * 1000);
}

function envLabel(environment: string | null): string {
  return environment ? ` in ${environment}` : "";
}

type ConditionEvalResult =
  | { ok: true; summary: string; hrefHint?: "errors" | "sessions" | "billing" | "overview" }
  | { ok: false };

async function countErrorOccurrences(
  prisma: PrismaClient,
  projectId: string,
  since: Date,
  environment: string | null
): Promise<number> {
  return prisma.errorOccurrence.count({
    where: {
      created_at: { gte: since },
      ...(environment ? { environment } : {}),
      error_group: { project_id: projectId },
    },
  });
}

async function countSessions(
  prisma: PrismaClient,
  projectId: string,
  startedAtGte: Date,
  startedAtLt: Date | null,
  environment: string | null
): Promise<number> {
  return prisma.session.count({
    where: {
      project_id: projectId,
      started_at: {
        gte: startedAtGte,
        ...(startedAtLt ? { lt: startedAtLt } : {}),
      },
      ...(environment ? { environment } : {}),
    },
  });
}

async function countEvents(
  prisma: PrismaClient,
  projectId: string,
  since: Date,
  environment: string | null
): Promise<number> {
  return prisma.event.count({
    where: {
      project_id: projectId,
      created_at: { gte: since },
      ...(environment ? { environment } : {}),
    },
  });
}

async function evaluateErrorCountCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: ErrorCountCondition
): Promise<ConditionEvalResult> {
  const count = await countErrorOccurrences(
    prisma,
    projectId,
    windowSince(condition.windowMinutes),
    condition.environment
  );
  if (count < condition.threshold) return { ok: false };
  return {
    ok: true,
    hrefHint: "errors",
    summary: `${count.toLocaleString()} errors in the last ${condition.windowMinutes} minutes${envLabel(condition.environment)} (threshold ${condition.threshold})`,
  };
}

async function evaluateErrorRateCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: ErrorRateCondition
): Promise<ConditionEvalResult> {
  const since = windowSince(condition.windowMinutes);
  const [errors, sessions] = await Promise.all([
    countErrorOccurrences(prisma, projectId, since, condition.environment),
    countSessions(prisma, projectId, since, null, condition.environment),
  ]);
  if (sessions <= 0) return { ok: false };
  const ratePercent = (errors / sessions) * 100;
  if (ratePercent < condition.thresholdPercent) return { ok: false };
  return {
    ok: true,
    hrefHint: "errors",
    summary: `error rate ${ratePercent.toFixed(1)}% (${errors.toLocaleString()} errors / ${sessions.toLocaleString()} sessions) in the last ${condition.windowMinutes} minutes${envLabel(condition.environment)} (threshold ${condition.thresholdPercent}%)`,
  };
}

async function evaluateSessionDropCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: SessionDropCondition
): Promise<ConditionEvalResult> {
  const now = Date.now();
  const windowMs = condition.windowMinutes * 60 * 1000;
  const currentStart = new Date(now - windowMs);
  const previousStart = new Date(now - 2 * windowMs);
  const previousEnd = currentStart;

  const [current, previous] = await Promise.all([
    countSessions(prisma, projectId, currentStart, null, condition.environment),
    countSessions(
      prisma,
      projectId,
      previousStart,
      previousEnd,
      condition.environment
    ),
  ]);
  if (previous <= 0) return { ok: false };
  const dropPercent = ((previous - current) / previous) * 100;
  if (dropPercent < condition.dropPercent) return { ok: false };
  return {
    ok: true,
    hrefHint: "sessions",
    summary: `sessions dropped ${dropPercent.toFixed(1)}% (${previous.toLocaleString()} → ${current.toLocaleString()}) over ${condition.windowMinutes} minutes${envLabel(condition.environment)} (threshold ${condition.dropPercent}%)`,
  };
}

async function evaluateNewErrorGroupCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: NewErrorGroupCondition
): Promise<ConditionEvalResult> {
  const since = windowSince(condition.windowMinutes);
  const count = await prisma.errorGroup.count({
    where: {
      project_id: projectId,
      first_seen: { gte: since },
      ...(condition.environment
        ? {
            occurrences_list: {
              some: { environment: condition.environment },
            },
          }
        : {}),
    },
  });
  if (count < 1) return { ok: false };
  return {
    ok: true,
    hrefHint: "errors",
    summary: `${count.toLocaleString()} new error group${count === 1 ? "" : "s"} in the last ${condition.windowMinutes} minutes${envLabel(condition.environment)}`,
  };
}

async function evaluateAffectedUsersCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: AffectedUsersCondition
): Promise<ConditionEvalResult> {
  const since = windowSince(condition.windowMinutes);
  const groups = await prisma.errorOccurrence.groupBy({
    by: ["user_id"],
    where: {
      created_at: { gte: since },
      user_id: { not: null },
      ...(condition.environment ? { environment: condition.environment } : {}),
      error_group: { project_id: projectId },
    },
  });
  const count = groups.length;
  if (count < condition.threshold) return { ok: false };
  return {
    ok: true,
    hrefHint: "errors",
    summary: `${count.toLocaleString()} affected users in the last ${condition.windowMinutes} minutes${envLabel(condition.environment)} (threshold ${condition.threshold})`,
  };
}

async function evaluateQuotaPercentCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: QuotaPercentCondition
): Promise<ConditionEvalResult> {
  const { loadPlanContextForProject, getMonthlyIngestUsed } = await import(
    "./plan-enforcement.js"
  );
  const ctx = await loadPlanContextForProject(prisma, projectId);
  if (!ctx) return { ok: false };
  const limit = ctx.limits.monthlyIngestUnits;
  if (limit <= 0) return { ok: false };
  const used = await getMonthlyIngestUsed(prisma, projectId);
  const percentUsed = Math.round((used / limit) * 100);
  if (percentUsed < condition.thresholdPercent) return { ok: false };
  return {
    ok: true,
    hrefHint: "billing",
    summary: `quota at ${percentUsed}% (${used.toLocaleString()} / ${limit.toLocaleString()} units; threshold ${condition.thresholdPercent}%)`,
  };
}

async function evaluateNoEventsCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: NoEventsCondition
): Promise<ConditionEvalResult> {
  const count = await countEvents(
    prisma,
    projectId,
    windowSince(condition.windowMinutes),
    condition.environment
  );
  if (count > 0) return { ok: false };
  return {
    ok: true,
    hrefHint: "overview",
    summary: `no events in the last ${condition.windowMinutes} minutes${envLabel(condition.environment)}`,
  };
}

async function evaluateHeartbeatCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: HeartbeatCondition
): Promise<ConditionEvalResult> {
  const since = windowSince(condition.windowMinutes);
  const [events, sessions, errors] = await Promise.all([
    countEvents(prisma, projectId, since, condition.environment),
    countSessions(prisma, projectId, since, null, condition.environment),
    countErrorOccurrences(prisma, projectId, since, condition.environment),
  ]);
  if (events > 0 || sessions > 0 || errors > 0) return { ok: false };
  return {
    ok: true,
    hrefHint: "overview",
    summary: `no telemetry (events/sessions/errors) in the last ${condition.windowMinutes} minutes${envLabel(condition.environment)}`,
  };
}

async function evaluateCondition(
  prisma: PrismaClient,
  projectId: string,
  condition: AlertRuleCondition
): Promise<ConditionEvalResult> {
  switch (condition.type) {
    case "ERROR_COUNT":
      return evaluateErrorCountCondition(prisma, projectId, condition);
    case "ERROR_RATE":
      return evaluateErrorRateCondition(prisma, projectId, condition);
    case "SESSION_DROP":
      return evaluateSessionDropCondition(prisma, projectId, condition);
    case "NEW_ERROR_GROUP":
      return evaluateNewErrorGroupCondition(prisma, projectId, condition);
    case "AFFECTED_USERS":
      return evaluateAffectedUsersCondition(prisma, projectId, condition);
    case "QUOTA_PERCENT":
      return evaluateQuotaPercentCondition(prisma, projectId, condition);
    case "NO_EVENTS":
      return evaluateNoEventsCondition(prisma, projectId, condition);
    case "HEARTBEAT":
      return evaluateHeartbeatCondition(prisma, projectId, condition);
    default: {
      const _exhaustive: never = condition;
      return _exhaustive;
    }
  }
}

function hrefForHints(
  hints: Array<NonNullable<Extract<ConditionEvalResult, { ok: true }>["hrefHint"]>>
): string {
  if (hints.includes("billing") && hints.every((h) => h === "billing")) {
    return "/dashboard/settings/billing";
  }
  if (hints.includes("sessions") && !hints.includes("errors")) {
    return "/dashboard/sessions";
  }
  if (hints.includes("overview") && !hints.includes("errors") && !hints.includes("sessions")) {
    return "/dashboard/overview?range=24h";
  }
  return "/dashboard/errors";
}

/**
 * Evaluate one rule: AND all known conditions, then fire via Notifications dispatch.
 * Unknown condition types are already filtered by parseStoredConditions.
 * If no supported conditions remain, the rule must not fire.
 */
async function evaluateAlertRule(
  prisma: PrismaClient,
  projectId: string,
  rule: AlertRulePublic
): Promise<boolean> {
  if (rule.conditions.length === 0) return false;

  const summaryParts: string[] = [];
  const hrefHints: Array<
    NonNullable<Extract<ConditionEvalResult, { ok: true }>["hrefHint"]>
  > = [];

  for (const condition of rule.conditions) {
    const result = await evaluateCondition(prisma, projectId, condition);
    if (!result.ok) return false;
    summaryParts.push(result.summary);
    if (result.hrefHint) hrefHints.push(result.hrefHint);
  }

  const claimedAt = await tryClaimAlertRuleFire(
    prisma,
    rule.id,
    rule.cooldownMinutes
  );
  if (!claimedAt) return false;

  const dedupeKey = alertRuleDedupeKey(rule.id, claimedAt.getTime());
  try {
    return await fireProjectAlert(prisma, {
      projectId,
      rule: "ALERT_RULE",
      dedupeKey,
      title: rule.name,
      body: `${summaryParts.join("; ")}.`,
      href: hrefForHints(hrefHints),
      destinations: resolveDestinationIds(rule.destinationIds),
    });
  } catch (e) {
    await releaseAlertRuleFireClaim(prisma, rule.id, claimedAt);
    throw e;
  }
}

export type AlertRuleEvaluationPath = "ingest" | "scheduled";

/**
 * Evaluate enabled custom alert rules for a project.
 * Unknown / unparsable condition items are skipped; rules with no valid conditions never fire.
 */
export async function evaluateAlertRulesForProject(
  prisma: PrismaClient,
  projectId: string,
  path: AlertRuleEvaluationPath
): Promise<{ evaluated: number; fired: number }> {
  const rules = await listAlertRules(prisma, projectId);
  let evaluated = 0;
  let fired = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.conditions.length === 0) continue;
    if (path === "ingest" && !ruleNeedsIngestEvaluation(rule)) continue;
    if (path === "scheduled" && !ruleNeedsScheduledEvaluation(rule)) continue;
    evaluated += 1;
    const didFire = await evaluateAlertRule(prisma, projectId, rule);
    if (didFire) fired += 1;
  }
  return { evaluated, fired };
}

/**
 * Evaluate enabled custom alert rules for a project (ingest-triggered).
 */
export async function maybeEvaluateAlertRules(
  prisma: PrismaClient,
  projectId: string
): Promise<void> {
  await evaluateAlertRulesForProject(prisma, projectId, "ingest");
}

export type ScheduledAlertRuleEvaluationResult = {
  projectsScanned: number;
  rulesEvaluated: number;
  rulesFired: number;
};

/**
 * Idempotent scheduled sweep: evaluate rules that include schedule-oriented conditions.
 * last_fired_at cooldown claims prevent re-fires until cooldownMinutes elapse.
 */
export async function runScheduledAlertRuleEvaluation(
  prisma: PrismaClient
): Promise<ScheduledAlertRuleEvaluationResult> {
  const projectRows = await prisma.alertRule.findMany({
    where: { deleted_at: null, enabled: true, source: "CUSTOM" },
    select: { project_id: true },
    distinct: ["project_id"],
  });

  let rulesEvaluated = 0;
  let rulesFired = 0;
  for (const { project_id: projectId } of projectRows) {
    // Match ingest auth: skip soft-deleted projects and soft-deleted orgs.
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        deleted_at: null,
        organization: { deleted_at: null },
      },
      select: { id: true },
    });
    if (!project) continue;
    const result = await evaluateAlertRulesForProject(
      prisma,
      projectId,
      "scheduled"
    );
    rulesEvaluated += result.evaluated;
    rulesFired += result.fired;
  }

  return {
    projectsScanned: projectRows.length,
    rulesEvaluated,
    rulesFired,
  };
}
