import { describe, expect, it } from "vitest";
import {
  alertRuleSupportsDashboardEditor,
  changeDraftConditionType,
  createDefaultAlertRuleDraft,
  createEmptyNoEventsCondition,
  DEFAULT_NO_EVENTS_WINDOW_HOURS,
  draftFromAlertRule,
  formatAlertRuleSummary,
  isAlertRuleRow,
  updateDraftCondition,
  validateAlertRuleDraft,
  type AlertRuleRow,
} from "./alert-rules";

const baseRule = {
  id: "rule-hb",
  name: "Signups stopped",
  enabled: true,
  destinationIds: ["project-email"],
  cooldownMinutes: 360,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

describe("NO_EVENTS business heartbeats (dashboard)", () => {
  it("accepts NO_EVENTS rows with and without eventName", () => {
    for (const extra of [{}, { eventName: "signup_verified" }, { eventName: null }]) {
      expect(
        isAlertRuleRow({
          ...baseRule,
          conditions: [
            { type: "NO_EVENTS", windowMinutes: 360, environment: null, ...extra },
          ],
        })
      ).toBe(true);
    }
    expect(
      isAlertRuleRow({
        ...baseRule,
        conditions: [
          { type: "NO_EVENTS", windowMinutes: 360, environment: null, eventName: 5 },
        ],
      })
    ).toBe(false);
  });

  it("defaults a new heartbeat to 6h and syncs the default cooldown to the window", () => {
    const draft = changeDraftConditionType(createDefaultAlertRuleDraft(), 0, "NO_EVENTS");
    const c = draft.conditions[0]!;
    expect(c.type).toBe("NO_EVENTS");
    if (c.type === "NO_EVENTS") expect(c.windowHours).toBe(DEFAULT_NO_EVENTS_WINDOW_HOURS);
    expect(draft.cooldownMinutes).toBe(6 * 60);

    const longer = updateDraftCondition(draft, 0, { windowHours: 12 });
    expect(longer.cooldownMinutes).toBe(12 * 60);

    const back = changeDraftConditionType(longer, 0, "ERROR_COUNT");
    expect(back.cooldownMinutes).toBe(15);
  });

  it("leaves a hand-picked cooldown alone", () => {
    const draft = {
      ...changeDraftConditionType(createDefaultAlertRuleDraft(), 0, "NO_EVENTS"),
      cooldownMinutes: 90,
    };
    expect(updateDraftCondition(draft, 0, { windowHours: 3 }).cooldownMinutes).toBe(90);
  });

  it("serializes a heartbeat draft to a trimmed NO_EVENTS payload", () => {
    const draft = {
      ...createDefaultAlertRuleDraft(),
      name: "Signups",
      cooldownMinutes: 360,
      conditions: [
        createEmptyNoEventsCondition({
          eventName: "  signup_verified ",
          windowHours: 6,
          environment: " production ",
        }),
      ],
    };
    const result = validateAlertRuleDraft(draft);
    expect(result).toEqual({
      ok: true,
      payload: {
        name: "Signups",
        cooldownMinutes: 360,
        destinationIds: ["project-email"],
        conditions: [
          {
            type: "NO_EVENTS",
            windowMinutes: 360,
            environment: "production",
            eventName: "signup_verified",
          },
        ],
      },
    });
  });

  it("omits eventName when left empty (any event)", () => {
    const result = validateAlertRuleDraft({
      ...createDefaultAlertRuleDraft(),
      name: "Any",
      conditions: [createEmptyNoEventsCondition({ windowHours: 2 })],
    });
    expect(result.ok && result.payload.conditions[0]).toEqual({
      type: "NO_EVENTS",
      windowMinutes: 120,
      environment: null,
    });
  });

  it("rejects windows outside 1–24h and over-long names", () => {
    for (const windowHours of [0, 25, 1.5]) {
      const r = validateAlertRuleDraft({
        ...createDefaultAlertRuleDraft(),
        name: "x",
        conditions: [createEmptyNoEventsCondition({ windowHours })],
      });
      expect(r.ok).toBe(false);
    }
    const r = validateAlertRuleDraft({
      ...createDefaultAlertRuleDraft(),
      name: "x",
      conditions: [createEmptyNoEventsCondition({ eventName: "e".repeat(201) })],
    });
    expect(r.ok).toBe(false);
  });

  it("round-trips an hour-window rule through the editor draft", () => {
    const rule: AlertRuleRow = {
      ...baseRule,
      conditions: [
        {
          type: "NO_EVENTS",
          windowMinutes: 720,
          environment: "production",
          eventName: "daily_job_finished",
        },
        { type: "ERROR_COUNT", threshold: 5, windowMinutes: 15, environment: null },
      ],
    };
    expect(alertRuleSupportsDashboardEditor(rule)).toBe(true);
    const draft = draftFromAlertRule(rule);
    expect(draft.conditions.map((c) => c.type)).toEqual(["NO_EVENTS", "ERROR_COUNT"]);
    const result = validateAlertRuleDraft(draft);
    expect(result.ok && result.payload.conditions).toEqual(rule.conditions);
    expect(result.ok && result.payload.cooldownMinutes).toBe(360);
  });

  it("keeps API-created minute-window NO_EVENTS rules out of the editor", () => {
    const rule: AlertRuleRow = {
      ...baseRule,
      conditions: [{ type: "NO_EVENTS", windowMinutes: 5, environment: null }],
    };
    expect(alertRuleSupportsDashboardEditor(rule)).toBe(false);
    expect(formatAlertRuleSummary(rule)).toBe("no events / 5m");
  });

  it("summarizes named heartbeats", () => {
    expect(
      formatAlertRuleSummary({
        ...baseRule,
        conditions: [
          {
            type: "NO_EVENTS",
            windowMinutes: 360,
            environment: "production",
            eventName: "signup_verified",
          },
        ],
      })
    ).toBe('no "signup_verified" event / 6h in production');
  });
});
