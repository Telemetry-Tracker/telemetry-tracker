/** Opaque destination id for project alert email (Notifications resolves delivery). */
export const PROJECT_EMAIL_DESTINATION_ID = "project-email";

/** Mirrors API `MAX_CONDITIONS_PER_RULE`. */
export const MAX_ALERT_RULE_CONDITIONS = 8;

export const MAX_ALERT_RULE_NAME_LENGTH = 120;
export const MIN_ALERT_COOLDOWN_MINUTES = 5;
export const MAX_ALERT_COOLDOWN_MINUTES = 24 * 60;
export const MIN_ERROR_COUNT_THRESHOLD = 1;
export const MAX_ERROR_COUNT_THRESHOLD = 10_000;
export const MIN_ERROR_COUNT_WINDOW_MINUTES = 5;
export const MAX_ERROR_COUNT_WINDOW_MINUTES = 24 * 60;
/** NO_EVENTS ("business heartbeat") windows are authored in whole hours, 1–24. */
export const MIN_NO_EVENTS_WINDOW_HOURS = 1;
export const MAX_NO_EVENTS_WINDOW_HOURS = 24;
/** Default "no event for X hours" — hours, not minutes, to avoid false alarms. */
export const DEFAULT_NO_EVENTS_WINDOW_HOURS = 6;
/** Default cooldown for a rule that only uses error-count conditions. */
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 15;
/** Mirrors API `MAX_ALERT_RULE_EVENT_NAME_LENGTH`. */
export const MAX_ALERT_RULE_EVENT_NAME_LENGTH = 200;

/** Mirrors API condition kinds (#534). Dashboard editor authors ERROR_COUNT and NO_EVENTS. */
export type AlertConditionType =
  | "ERROR_COUNT"
  | "ERROR_RATE"
  | "SESSION_DROP"
  | "NEW_ERROR_GROUP"
  | "AFFECTED_USERS"
  | "QUOTA_PERCENT"
  | "NO_EVENTS"
  | "HEARTBEAT";

export type ErrorCountCondition = {
  type: "ERROR_COUNT";
  threshold: number;
  windowMinutes: number;
  environment: string | null;
};

export type ErrorRateCondition = {
  type: "ERROR_RATE";
  thresholdPercent: number;
  windowMinutes: number;
  environment: string | null;
};

export type SessionDropCondition = {
  type: "SESSION_DROP";
  dropPercent: number;
  windowMinutes: number;
  environment: string | null;
};

export type NewErrorGroupCondition = {
  type: "NEW_ERROR_GROUP";
  windowMinutes: number;
  environment: string | null;
};

export type AffectedUsersCondition = {
  type: "AFFECTED_USERS";
  threshold: number;
  windowMinutes: number;
  environment: string | null;
};

export type QuotaPercentCondition = {
  type: "QUOTA_PERCENT";
  thresholdPercent: number;
};

export type NoEventsCondition = {
  type: "NO_EVENTS";
  windowMinutes: number;
  environment: string | null;
  /** Exact event name to watch; omitted/null = any event. */
  eventName?: string | null;
};

export type HeartbeatCondition = {
  type: "HEARTBEAT";
  windowMinutes: number;
  environment: string | null;
};

export type AlertRuleCondition =
  | ErrorCountCondition
  | ErrorRateCondition
  | SessionDropCondition
  | NewErrorGroupCondition
  | AffectedUsersCondition
  | QuotaPercentCondition
  | NoEventsCondition
  | HeartbeatCondition;

export type AlertRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  /** AND of conditions. */
  conditions: AlertRuleCondition[];
  /** Opaque destination ids resolved by Notifications. */
  destinationIds: string[];
  cooldownMinutes: number;
  createdAt: string;
  updatedAt: string;
};

/** Client draft for create / edit forms (environment is a free-text field). */
export type ErrorCountConditionDraft = {
  /** Stable React key — not sent to the API. */
  key: string;
  type: "ERROR_COUNT";
  threshold: number;
  windowMinutes: number;
  environment: string;
};

/** "No `eventName` event for `windowHours` hours" (business heartbeat). */
export type NoEventsConditionDraft = {
  key: string;
  type: "NO_EVENTS";
  /** Empty = any event (original NO_EVENTS behaviour). */
  eventName: string;
  windowHours: number;
  environment: string;
};

export type AlertRuleConditionDraft =
  | ErrorCountConditionDraft
  | NoEventsConditionDraft;

/** Condition types the dashboard editor can author. */
export type EditableConditionType = AlertRuleConditionDraft["type"];

export type AlertRuleFormDraft = {
  name: string;
  conditions: AlertRuleConditionDraft[];
  destinationIds: string[];
  cooldownMinutes: number;
};

export type AlertRulePayload = {
  name: string;
  conditions: AlertRuleCondition[];
  destinationIds: string[];
  cooldownMinutes: number;
};

export type AlertRuleDraftValidation =
  | { ok: true; payload: AlertRulePayload }
  | { ok: false; error: string };

export type DestinationOption = {
  id: string;
  label: string;
  /** Short channel kind for display (Email, Slack, …). */
  kind: string;
  enabled: boolean;
};

let draftKeySeq = 0;

function nextDraftKey(): string {
  draftKeySeq += 1;
  return `cond-${draftKeySeq}`;
}

export function createEmptyErrorCountCondition(
  overrides?: Partial<Omit<ErrorCountConditionDraft, "type" | "key">>
): ErrorCountConditionDraft {
  return {
    key: nextDraftKey(),
    type: "ERROR_COUNT",
    threshold: overrides?.threshold ?? 25,
    windowMinutes: overrides?.windowMinutes ?? 15,
    environment: overrides?.environment ?? "",
  };
}

export function createEmptyNoEventsCondition(
  overrides?: Partial<Omit<NoEventsConditionDraft, "type" | "key">>
): NoEventsConditionDraft {
  return {
    key: nextDraftKey(),
    type: "NO_EVENTS",
    eventName: overrides?.eventName ?? "",
    windowHours: overrides?.windowHours ?? DEFAULT_NO_EVENTS_WINDOW_HOURS,
    environment: overrides?.environment ?? "",
  };
}

export function createDefaultAlertRuleDraft(): AlertRuleFormDraft {
  return {
    name: "",
    conditions: [createEmptyErrorCountCondition()],
    destinationIds: [PROJECT_EMAIL_DESTINATION_ID],
    cooldownMinutes: DEFAULT_ALERT_COOLDOWN_MINUTES,
  };
}

/** Longest NO_EVENTS window in the draft, in minutes (0 when there is none). */
function longestNoEventsWindowMinutes(
  conditions: AlertRuleConditionDraft[]
): number {
  let max = 0;
  for (const c of conditions) {
    if (c.type === "NO_EVENTS") max = Math.max(max, c.windowHours * 60);
  }
  return max;
}

/**
 * Keep the cooldown in step with NO_EVENTS windows while the user has not
 * chosen one: a still-silent heartbeat re-fires every cooldown, so the
 * default cooldown for heartbeat rules equals the window (e.g. 6h → 6h).
 * A cooldown the user already changed by hand is left alone.
 */
function syncedCooldown(
  previous: AlertRuleFormDraft,
  nextConditions: AlertRuleConditionDraft[]
): number {
  const prevWindow = longestNoEventsWindowMinutes(previous.conditions);
  const autoValue = prevWindow > 0 ? prevWindow : DEFAULT_ALERT_COOLDOWN_MINUTES;
  if (previous.cooldownMinutes !== autoValue) return previous.cooldownMinutes;
  const nextWindow = longestNoEventsWindowMinutes(nextConditions);
  return nextWindow > 0 ? nextWindow : DEFAULT_ALERT_COOLDOWN_MINUTES;
}

/** Replace condition `index` with a fresh condition of `type` (editor Type select). */
export function changeDraftConditionType(
  draft: AlertRuleFormDraft,
  index: number,
  type: EditableConditionType
): AlertRuleFormDraft {
  const current = draft.conditions[index];
  if (!current || current.type === type) return draft;
  const replacement: AlertRuleConditionDraft =
    type === "NO_EVENTS"
      ? createEmptyNoEventsCondition({ environment: current.environment })
      : createEmptyErrorCountCondition({ environment: current.environment });
  const conditions = draft.conditions.map((c, i) =>
    i === index ? replacement : c
  );
  return {
    ...draft,
    conditions,
    cooldownMinutes: syncedCooldown(draft, conditions),
  };
}

/** Patch one condition (same type) and keep an untouched cooldown in step. */
export function updateDraftCondition(
  draft: AlertRuleFormDraft,
  index: number,
  patch: Partial<Omit<ErrorCountConditionDraft, "key" | "type">> &
    Partial<Omit<NoEventsConditionDraft, "key" | "type">>
): AlertRuleFormDraft {
  const conditions = draft.conditions.map((c, i) => {
    if (i !== index) return c;
    if (c.type === "ERROR_COUNT") {
      return {
        ...c,
        ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
        ...(patch.windowMinutes !== undefined
          ? { windowMinutes: patch.windowMinutes }
          : {}),
        ...(patch.environment !== undefined
          ? { environment: patch.environment }
          : {}),
      };
    }
    return {
      ...c,
      ...(patch.eventName !== undefined ? { eventName: patch.eventName } : {}),
      ...(patch.windowHours !== undefined
        ? { windowHours: patch.windowHours }
        : {}),
      ...(patch.environment !== undefined
        ? { environment: patch.environment }
        : {}),
    };
  });
  return {
    ...draft,
    conditions,
    cooldownMinutes: syncedCooldown(draft, conditions),
  };
}

function noEventsConditionIsEditable(c: NoEventsCondition): boolean {
  // The editor works in whole hours; API-created minute windows stay API-only
  // so opening them never silently rounds the window.
  return (
    c.windowMinutes % 60 === 0 &&
    c.windowMinutes / 60 >= MIN_NO_EVENTS_WINDOW_HOURS &&
    c.windowMinutes / 60 <= MAX_NO_EVENTS_WINDOW_HOURS
  );
}

/**
 * Dashboard create/edit form authors ERROR_COUNT and NO_EVENTS (hour windows).
 * Rules with other condition kinds (#534) remain listable/toggleable/removable.
 */
export function alertRuleSupportsDashboardEditor(rule: AlertRuleRow): boolean {
  if (rule.conditions.length === 0) return true;
  return rule.conditions.every(
    (c) =>
      c.type === "ERROR_COUNT" ||
      (c.type === "NO_EVENTS" && noEventsConditionIsEditable(c))
  );
}

export function draftFromAlertRule(rule: AlertRuleRow): AlertRuleFormDraft {
  // Preserve empty conditions as-is. API `toPublic` maps wholly-unparsable stored JSON
  // to []; do not synthesize a default ERROR_COUNT — that would let an edit that
  // only changes name/cooldown/destinations persist thresholds and re-arm the rule.
  const editableConditions: AlertRuleConditionDraft[] = [];
  for (const c of rule.conditions) {
    if (c.type === "ERROR_COUNT") {
      editableConditions.push(
        createEmptyErrorCountCondition({
          threshold: c.threshold,
          windowMinutes: c.windowMinutes,
          environment: c.environment ?? "",
        })
      );
    } else if (c.type === "NO_EVENTS" && noEventsConditionIsEditable(c)) {
      editableConditions.push(
        createEmptyNoEventsCondition({
          eventName: c.eventName ?? "",
          windowHours: c.windowMinutes / 60,
          environment: c.environment ?? "",
        })
      );
    }
  }
  const conditions =
    editableConditions.length > 0
      ? editableConditions
      : rule.conditions.length === 0
        ? []
        : [createEmptyErrorCountCondition()];
  return {
    name: rule.name,
    conditions,
    destinationIds: [...rule.destinationIds],
    cooldownMinutes: rule.cooldownMinutes,
  };
}

export function conditionTypeLabel(type: AlertConditionType): string {
  switch (type) {
    case "ERROR_COUNT":
      return "Error count";
    case "ERROR_RATE":
      return "Error rate";
    case "SESSION_DROP":
      return "Session drop";
    case "NEW_ERROR_GROUP":
      return "New error group";
    case "AFFECTED_USERS":
      return "Affected users";
    case "QUOTA_PERCENT":
      return "Quota percent";
    case "NO_EVENTS":
      return "No events (heartbeat)";
    case "HEARTBEAT":
      return "Heartbeat";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function formatConditionSummary(c: AlertRuleCondition): string {
  switch (c.type) {
    case "ERROR_COUNT": {
      const env = c.environment ? ` in ${c.environment}` : "";
      return `≥ ${c.threshold} errors / ${c.windowMinutes}m${env}`;
    }
    case "ERROR_RATE": {
      const env = c.environment ? ` in ${c.environment}` : "";
      return `≥ ${c.thresholdPercent}% error rate / ${c.windowMinutes}m${env}`;
    }
    case "SESSION_DROP": {
      const env = c.environment ? ` in ${c.environment}` : "";
      return `≥ ${c.dropPercent}% session drop / ${c.windowMinutes}m${env}`;
    }
    case "NEW_ERROR_GROUP": {
      const env = c.environment ? ` in ${c.environment}` : "";
      return `new error group / ${c.windowMinutes}m${env}`;
    }
    case "AFFECTED_USERS": {
      const env = c.environment ? ` in ${c.environment}` : "";
      return `≥ ${c.threshold} affected users / ${c.windowMinutes}m${env}`;
    }
    case "QUOTA_PERCENT":
      return `≥ ${c.thresholdPercent}% quota`;
    case "NO_EVENTS": {
      const env = c.environment ? ` in ${c.environment}` : "";
      const window =
        c.windowMinutes % 60 === 0 ? `${c.windowMinutes / 60}h` : `${c.windowMinutes}m`;
      if (c.eventName) return `no "${c.eventName}" event / ${window}${env}`;
      return `no events / ${window}${env}`;
    }
    case "HEARTBEAT": {
      const env = c.environment ? ` in ${c.environment}` : "";
      return `no telemetry / ${c.windowMinutes}m${env}`;
    }
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

export function formatAlertRuleSummary(rule: AlertRuleRow): string {
  if (rule.conditions.length === 0) {
    // API returns [] when stored conditions fail validation; rule still exists
    // and must remain visible so editors can disable/remove it.
    return "Invalid or unsupported conditions";
  }
  return rule.conditions.map(formatConditionSummary).join(" AND ");
}

/** Human-readable destination bindings for rule list rows. */
export function formatAlertRuleDestinations(
  destinationIds: string[],
  options: DestinationOption[]
): string {
  if (destinationIds.length === 0) return "no destinations";
  const byId = new Map(options.map((o) => [o.id, o]));
  const parts: string[] = [];
  let missing = 0;
  for (const id of destinationIds) {
    if (id === PROJECT_EMAIL_DESTINATION_ID) {
      parts.push("project email");
      continue;
    }
    const opt = byId.get(id);
    if (!opt) {
      missing += 1;
      continue;
    }
    const status = opt.enabled ? "" : " (disabled)";
    parts.push(`${opt.kind}${status}`);
  }
  if (missing > 0) {
    parts.push(
      `${missing} missing binding${missing === 1 ? "" : "s"}`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "no destinations";
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Validate a create/edit draft against API limits.
 * Requires ≥1 condition, ≥1 destination, and in-range numeric fields.
 */
export function validateAlertRuleDraft(
  draft: AlertRuleFormDraft
): AlertRuleDraftValidation {
  const name = draft.name.trim();
  if (!name) {
    return { ok: false, error: "Name is required" };
  }
  if (name.length > MAX_ALERT_RULE_NAME_LENGTH) {
    return {
      ok: false,
      error: `Name must be at most ${MAX_ALERT_RULE_NAME_LENGTH} characters`,
    };
  }
  if (draft.conditions.length === 0) {
    return { ok: false, error: "Add at least one condition" };
  }
  if (draft.conditions.length > MAX_ALERT_RULE_CONDITIONS) {
    return {
      ok: false,
      error: `At most ${MAX_ALERT_RULE_CONDITIONS} conditions per rule`,
    };
  }
  if (draft.destinationIds.length === 0) {
    return {
      ok: false,
      error: "Select at least one destination (email or a Delivery channel)",
    };
  }

  const conditions: AlertRuleCondition[] = [];
  for (let i = 0; i < draft.conditions.length; i++) {
    const c = draft.conditions[i]!;
    if (c.type === "NO_EVENTS") {
      const windowHours = clampInt(
        c.windowHours,
        MIN_NO_EVENTS_WINDOW_HOURS,
        MAX_NO_EVENTS_WINDOW_HOURS
      );
      if (c.windowHours !== windowHours) {
        return {
          ok: false,
          error: `Condition #${i + 1}: window must be ${MIN_NO_EVENTS_WINDOW_HOURS}–${MAX_NO_EVENTS_WINDOW_HOURS} hours`,
        };
      }
      const eventName = c.eventName.trim();
      if (eventName.length > MAX_ALERT_RULE_EVENT_NAME_LENGTH) {
        return {
          ok: false,
          error: `Condition #${i + 1}: event name must be at most ${MAX_ALERT_RULE_EVENT_NAME_LENGTH} characters`,
        };
      }
      const noEventsEnv = c.environment.trim();
      if (noEventsEnv.length > 64) {
        return {
          ok: false,
          error: `Condition #${i + 1}: environment must be at most 64 characters`,
        };
      }
      conditions.push({
        type: "NO_EVENTS",
        windowMinutes: windowHours * 60,
        environment: noEventsEnv.length > 0 ? noEventsEnv : null,
        ...(eventName.length > 0 ? { eventName } : {}),
      });
      continue;
    }
    if (c.type !== "ERROR_COUNT") {
      return { ok: false, error: `Unsupported condition type at #${i + 1}` };
    }
    const threshold = clampInt(
      c.threshold,
      MIN_ERROR_COUNT_THRESHOLD,
      MAX_ERROR_COUNT_THRESHOLD
    );
    const windowMinutes = clampInt(
      c.windowMinutes,
      MIN_ERROR_COUNT_WINDOW_MINUTES,
      MAX_ERROR_COUNT_WINDOW_MINUTES
    );
    if (c.threshold !== threshold || c.windowMinutes !== windowMinutes) {
      return {
        ok: false,
        error: `Condition #${i + 1}: threshold must be ${MIN_ERROR_COUNT_THRESHOLD}–${MAX_ERROR_COUNT_THRESHOLD} and window ${MIN_ERROR_COUNT_WINDOW_MINUTES}–${MAX_ERROR_COUNT_WINDOW_MINUTES} minutes`,
      };
    }
    const env = c.environment.trim();
    if (env.length > 64) {
      return {
        ok: false,
        error: `Condition #${i + 1}: environment must be at most 64 characters`,
      };
    }
    conditions.push({
      type: "ERROR_COUNT",
      threshold,
      windowMinutes,
      environment: env.length > 0 ? env : null,
    });
  }

  const cooldownMinutes = clampInt(
    draft.cooldownMinutes,
    MIN_ALERT_COOLDOWN_MINUTES,
    MAX_ALERT_COOLDOWN_MINUTES
  );
  if (draft.cooldownMinutes !== cooldownMinutes) {
    return {
      ok: false,
      error: `Cooldown must be ${MIN_ALERT_COOLDOWN_MINUTES}–${MAX_ALERT_COOLDOWN_MINUTES} minutes`,
    };
  }

  const destinationIds = [...new Set(draft.destinationIds)];
  return {
    ok: true,
    payload: {
      name,
      conditions,
      destinationIds,
      cooldownMinutes,
    },
  };
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isEnvironment(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCondition(value: unknown): value is AlertRuleCondition {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  switch (o.type) {
    case "ERROR_COUNT":
      return (
        isNonNegativeInt(o.threshold) &&
        isNonNegativeInt(o.windowMinutes) &&
        isEnvironment(o.environment)
      );
    case "ERROR_RATE":
      return (
        isNonNegativeInt(o.thresholdPercent) &&
        isNonNegativeInt(o.windowMinutes) &&
        isEnvironment(o.environment)
      );
    case "SESSION_DROP":
      return (
        isNonNegativeInt(o.dropPercent) &&
        isNonNegativeInt(o.windowMinutes) &&
        isEnvironment(o.environment)
      );
    case "NEW_ERROR_GROUP":
      return isNonNegativeInt(o.windowMinutes) && isEnvironment(o.environment);
    case "AFFECTED_USERS":
      return (
        isNonNegativeInt(o.threshold) &&
        isNonNegativeInt(o.windowMinutes) &&
        isEnvironment(o.environment)
      );
    case "QUOTA_PERCENT":
      return isNonNegativeInt(o.thresholdPercent);
    case "NO_EVENTS":
      return (
        isNonNegativeInt(o.windowMinutes) &&
        isEnvironment(o.environment) &&
        (o.eventName === undefined ||
          o.eventName === null ||
          typeof o.eventName === "string")
      );
    case "HEARTBEAT":
      return isNonNegativeInt(o.windowMinutes) && isEnvironment(o.environment);
    default:
      return false;
  }
}

export function isAlertRuleRow(value: unknown): value is AlertRuleRow {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  // Empty conditions are allowed: API maps wholly-unparsable stored JSON to
  // [] (evaluation skips those rules). Editors must still see/remove them.
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.enabled === "boolean" &&
    Array.isArray(o.conditions) &&
    o.conditions.every(isCondition) &&
    Array.isArray(o.destinationIds) &&
    o.destinationIds.every((id) => typeof id === "string") &&
    typeof o.cooldownMinutes === "number" &&
    typeof o.createdAt === "string" &&
    typeof o.updatedAt === "string"
  );
}
