import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  alertRuleDedupeKey,
  createAlertRule,
  evaluateAlertRulesForProject,
  MAX_ALERT_RULES,
  maybeEvaluateAlertRules,
  parseStoredConditions,
  PROJECT_EMAIL_DESTINATION_ID,
  pruneDestinationIdFromAlertRules,
  resolveAlertRulesScheduleIntervalMinutes,
  resolveDestinationIds,
  ruleNeedsIngestEvaluation,
  ruleNeedsScheduledEvaluation,
  runScheduledAlertRuleEvaluation,
  softDeleteAlertRule,
  tryClaimAlertRuleFire,
  updateAlertRule,
  ALERT_RULES_SCHEDULE_INTERVAL_MINUTES,
  type AlertRulePublic,
} from "./alert-rules.js";
import { normalizeIngestEnvironment } from "./ingest-environment.js";

const fireProjectAlert = vi.fn(async () => true);
const loadPlanContextForProject = vi.fn(async () => ({
  planTier: "PRO",
  limits: { monthlyIngestUnits: 1000 },
}));
const getMonthlyIngestUsed = vi.fn(async () => 900);

vi.mock("./alert-dispatch.js", () => ({
  fireProjectAlert: (...args: unknown[]) => fireProjectAlert(...args),
}));

vi.mock("./plan-enforcement.js", () => ({
  loadPlanContextForProject: (...args: unknown[]) =>
    loadPlanContextForProject(...args),
  getMonthlyIngestUsed: (...args: unknown[]) => getMonthlyIngestUsed(...args),
}));

/** In-memory last_fired_at store that mirrors tryClaimAlertRuleFire WHERE semantics. */
function createLastFiredStore(initial: Date | null = null) {
  let lastFiredAt: Date | null = initial;
  const updateMany = vi.fn(
    async (args: {
      where: {
        id?: string;
        deleted_at?: null;
        last_fired_at?: Date;
        OR?: Array<
          { last_fired_at: null } | { last_fired_at: { lte: Date } }
        >;
      };
      data: { last_fired_at: Date | null };
    }) => {
      if (args.where.last_fired_at instanceof Date) {
        if (
          lastFiredAt === null ||
          lastFiredAt.getTime() !== args.where.last_fired_at.getTime()
        ) {
          return { count: 0 };
        }
        lastFiredAt = args.data.last_fired_at;
        return { count: 1 };
      }
      const or = args.where.OR ?? [];
      const cutoff = or.find(
        (c): c is { last_fired_at: { lte: Date } } =>
          typeof c.last_fired_at === "object" &&
          c.last_fired_at !== null &&
          "lte" in c.last_fired_at
      )?.last_fired_at.lte;
      const eligible =
        lastFiredAt === null ||
        (cutoff !== undefined && lastFiredAt.getTime() <= cutoff.getTime());
      if (!eligible) return { count: 0 };
      lastFiredAt = args.data.last_fired_at;
      return { count: 1 };
    }
  );
  return {
    updateMany,
    get lastFiredAt() {
      return lastFiredAt;
    },
  };
}

function claimAlways() {
  return vi.fn(async () => ({ count: 1 }));
}

describe("normalizeIngestEnvironment", () => {
  it("trims and caps to match alert-rule environment filters", () => {
    expect(normalizeIngestEnvironment("  production  ")).toBe("production");
    expect(normalizeIngestEnvironment("   ")).toBeNull();
    expect(normalizeIngestEnvironment(undefined)).toBeNull();
    expect(normalizeIngestEnvironment("x".repeat(80))).toHaveLength(64);
  });
});

describe("alertRuleDedupeKey", () => {
  it("is unique per claim timestamp for AlertEvent idempotency", () => {
    const t0 = Date.UTC(2026, 6, 18, 10, 14, 0);
    const t1 = t0 + 60_000;
    expect(alertRuleDedupeKey("r1", t0)).toBe("alert:rule:r1:" + t0);
    expect(alertRuleDedupeKey("r1", t0)).not.toBe(alertRuleDedupeKey("r1", t1));
  });
});

describe("tryClaimAlertRuleFire", () => {
  it("enforces elapsed cooldown across wall-clock bucket boundaries and concurrent claims", async () => {
    const store = createLastFiredStore();
    const prisma = { alertRule: { updateMany: store.updateMany } } as never;
    const cooldownMinutes = 15;
    // 15-minute wall buckets roll at :00/:15/:30/:45 — 10:14 → 10:15 crosses a bucket.
    const firstAt = new Date("2026-07-18T10:14:00.000Z");
    const bucketRollAt = new Date("2026-07-18T10:15:00.000Z");
    const beforeElapsed = new Date(
      firstAt.getTime() + cooldownMinutes * 60 * 1000 - 1
    );
    const exactlyElapsed = new Date(
      firstAt.getTime() + cooldownMinutes * 60 * 1000
    );

    const first = await tryClaimAlertRuleFire(
      prisma,
      "r1",
      cooldownMinutes,
      firstAt
    );
    expect(first).toEqual(firstAt);

    // Concurrent overlapping claim at the same instant must lose.
    const concurrent = await tryClaimAlertRuleFire(
      prisma,
      "r1",
      cooldownMinutes,
      firstAt
    );
    expect(concurrent).toBeNull();

    // Bucket boundary alone must not allow a re-fire.
    const acrossBucket = await tryClaimAlertRuleFire(
      prisma,
      "r1",
      cooldownMinutes,
      bucketRollAt
    );
    expect(acrossBucket).toBeNull();

    const stillCooling = await tryClaimAlertRuleFire(
      prisma,
      "r1",
      cooldownMinutes,
      beforeElapsed
    );
    expect(stillCooling).toBeNull();

    const afterCooldown = await tryClaimAlertRuleFire(
      prisma,
      "r1",
      cooldownMinutes,
      exactlyElapsed
    );
    expect(afterCooldown).toEqual(exactlyElapsed);
  });
});

describe("resolveDestinationIds", () => {
  it("maps opaque ids to Notifications fire filters", () => {
    expect(
      resolveDestinationIds([
        PROJECT_EMAIL_DESTINATION_ID,
        "22222222-2222-2222-2222-222222222222",
      ])
    ).toEqual({
      email: true,
      webhookIds: ["22222222-2222-2222-2222-222222222222"],
    });
    expect(resolveDestinationIds([])).toEqual({ email: false, webhookIds: [] });
  });
});

describe("resolveAlertRulesScheduleIntervalMinutes", () => {
  it("defaults and clamps env override", () => {
    expect(resolveAlertRulesScheduleIntervalMinutes({})).toBe(
      ALERT_RULES_SCHEDULE_INTERVAL_MINUTES
    );
    expect(
      resolveAlertRulesScheduleIntervalMinutes({
        ALERT_RULES_SCHEDULE_INTERVAL_MINUTES: "15",
      })
    ).toBe(15);
    expect(
      resolveAlertRulesScheduleIntervalMinutes({
        ALERT_RULES_SCHEDULE_INTERVAL_MINUTES: "0",
      })
    ).toBe(ALERT_RULES_SCHEDULE_INTERVAL_MINUTES);
  });
});

describe("parseStoredConditions", () => {
  it("keeps known conditions and skips unknown types without failing the group", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { conditions, skippedUnknown } = parseStoredConditions([
      {
        type: "ERROR_COUNT",
        threshold: 5,
        windowMinutes: 15,
        environment: null,
      },
      { type: "UNKNOWN_TYPE", threshold: 1 },
      {
        type: "HEARTBEAT",
        windowMinutes: 30,
        environment: "production",
      },
    ]);
    expect(skippedUnknown).toBe(1);
    expect(conditions).toEqual([
      {
        type: "ERROR_COUNT",
        threshold: 5,
        windowMinutes: 15,
        environment: null,
      },
      {
        type: "HEARTBEAT",
        windowMinutes: 30,
        environment: "production",
      },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("ruleNeedsIngestEvaluation / ruleNeedsScheduledEvaluation", () => {
  const base: Omit<AlertRulePublic, "conditions"> = {
    id: "r1",
    name: "n",
    enabled: true,
    destinationIds: [],
    cooldownMinutes: 15,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("classifies ingest vs scheduled condition types", () => {
    expect(
      ruleNeedsIngestEvaluation({
        ...base,
        conditions: [
          { type: "ERROR_COUNT", threshold: 1, windowMinutes: 15, environment: null },
        ],
      })
    ).toBe(true);
    expect(
      ruleNeedsScheduledEvaluation({
        ...base,
        conditions: [
          { type: "ERROR_COUNT", threshold: 1, windowMinutes: 15, environment: null },
        ],
      })
    ).toBe(false);
    expect(
      ruleNeedsIngestEvaluation({
        ...base,
        conditions: [{ type: "HEARTBEAT", windowMinutes: 15, environment: null }],
      })
    ).toBe(false);
    expect(
      ruleNeedsScheduledEvaluation({
        ...base,
        conditions: [{ type: "HEARTBEAT", windowMinutes: 15, environment: null }],
      })
    ).toBe(true);
  });
});

describe("createAlertRule", () => {
  it("rejects invalid payload", async () => {
    const prisma = { project: { findFirst: vi.fn() } } as never;
    const result = await createAlertRule(prisma, "p1", { name: "" });
    expect(result).toEqual({
      ok: false,
      error: "Invalid alert rule payload",
      status: 400,
    });
  });

  it("rejects destination ids outside the project", async () => {
    const prisma = {
      project: { findFirst: async () => ({ id: "p1" }) },
      projectWebhook: { count: async () => 0 },
    } as never;
    const result = await createAlertRule(prisma, "p1", {
      name: "Prod spike",
      conditions: [
        {
          type: "ERROR_COUNT",
          threshold: 10,
          windowMinutes: 15,
          environment: "production",
        },
      ],
      destinationIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(result).toEqual({
      ok: false,
      error: "One or more destinations were not found",
      status: 400,
    });
  });

  it("creates a rule when under the cap", async () => {
    const created = {
      id: "rule-1",
      name: "Prod spike",
      enabled: true,
      conditions: [
        {
          type: "ERROR_COUNT" as const,
          threshold: 10,
          windowMinutes: 15,
          environment: "production",
        },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID] as string[],
      cooldown_minutes: 15,
      created_at: new Date("2026-07-17T00:00:00.000Z"),
      updated_at: new Date("2026-07-17T00:00:00.000Z"),
    };
    const tx = {
      alertRule: {
        count: async () => 0,
        create: async () => created,
      },
    };
    const prisma = {
      project: { findFirst: async () => ({ id: "p1" }) },
      projectWebhook: { count: async () => 0 },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as never;

    const result = await createAlertRule(prisma, "p1", {
      name: "Prod spike",
      conditions: [
        {
          type: "ERROR_COUNT",
          threshold: 10,
          windowMinutes: 15,
          environment: "production",
        },
      ],
      destinationIds: [PROJECT_EMAIL_DESTINATION_ID],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe("Prod spike");
      expect(result.rule.conditions[0]?.environment).toBe("production");
      expect(result.rule.destinationIds).toEqual([PROJECT_EMAIL_DESTINATION_ID]);
    }
  });

  it("accepts HEARTBEAT and QUOTA_PERCENT conditions", async () => {
    const created = {
      id: "rule-2",
      name: "Silence",
      enabled: true,
      conditions: [
        { type: "HEARTBEAT" as const, windowMinutes: 30, environment: null },
        { type: "QUOTA_PERCENT" as const, thresholdPercent: 80 },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID] as string[],
      cooldown_minutes: 15,
      created_at: new Date("2026-07-17T00:00:00.000Z"),
      updated_at: new Date("2026-07-17T00:00:00.000Z"),
    };
    const tx = {
      alertRule: {
        count: async () => 0,
        create: async () => created,
      },
    };
    const prisma = {
      project: { findFirst: async () => ({ id: "p1" }) },
      projectWebhook: { count: async () => 0 },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as never;

    const result = await createAlertRule(prisma, "p1", {
      name: "Silence",
      conditions: [
        { type: "HEARTBEAT", windowMinutes: 30 },
        { type: "QUOTA_PERCENT", thresholdPercent: 80 },
      ],
      destinationIds: [PROJECT_EMAIL_DESTINATION_ID],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.conditions.map((c) => c.type)).toEqual([
        "HEARTBEAT",
        "QUOTA_PERCENT",
      ]);
    }
  });

  it("returns 409 when at MAX_ALERT_RULES", async () => {
    const tx = {
      alertRule: {
        count: async () => MAX_ALERT_RULES,
        create: vi.fn(),
      },
    };
    const prisma = {
      project: { findFirst: async () => ({ id: "p1" }) },
      projectWebhook: { count: async () => 0 },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as never;

    const result = await createAlertRule(prisma, "p1", {
      name: "Overflow",
      conditions: [{ type: "ERROR_COUNT", threshold: 5, windowMinutes: 10 }],
      destinationIds: [],
    });
    expect(result).toEqual({
      ok: false,
      error: `At most ${MAX_ALERT_RULES} alert rules per project`,
      status: 409,
    });
  });
});

describe("updateAlertRule / softDeleteAlertRule", () => {
  it("updates enabled flag", async () => {
    const existing = {
      id: "rule-1",
      project_id: "p1",
      name: "Prod spike",
      enabled: true,
      source: "CUSTOM" as const,
      conditions: [
        {
          type: "ERROR_COUNT" as const,
          threshold: 10,
          windowMinutes: 15,
          environment: null,
        },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date("2026-07-17T00:00:00.000Z"),
      updated_at: new Date("2026-07-17T00:00:00.000Z"),
      deleted_at: null,
    };
    const prisma = {
      alertRule: {
        findFirst: async () => existing,
        update: async ({ data }: { data: { enabled?: boolean } }) => ({
          ...existing,
          enabled: data.enabled ?? existing.enabled,
          updated_at: new Date("2026-07-17T01:00:00.000Z"),
        }),
      },
    } as never;
    const result = await updateAlertRule(prisma, "p1", "rule-1", { enabled: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.enabled).toBe(false);
  });

  it("rejects updates to SYSTEM rules", async () => {
    const prisma = {
      alertRule: {
        findFirst: async () => ({
          id: "sys-1",
          project_id: "p1",
          source: "SYSTEM",
          deleted_at: null,
        }),
      },
    } as never;
    const result = await updateAlertRule(prisma, "p1", "sys-1", { enabled: false });
    expect(result).toEqual({
      ok: false,
      error: "System-managed alert rules are edited via project alert settings",
      status: 403,
    });
  });

  it("soft-deletes a custom rule", async () => {
    const prisma = {
      alertRule: {
        findFirst: async () => ({ id: "rule-1", source: "CUSTOM" }),
        updateMany: async () => ({ count: 1 }),
      },
    } as never;
    expect(await softDeleteAlertRule(prisma, "p1", "rule-1")).toEqual({ ok: true });
  });

  it("rejects delete of SYSTEM rules", async () => {
    const prisma = {
      alertRule: {
        findFirst: async () => ({ id: "sys-1", source: "SYSTEM" }),
        updateMany: vi.fn(),
      },
    } as never;
    expect(await softDeleteAlertRule(prisma, "p1", "sys-1")).toEqual({
      ok: false,
      error: "System-managed alert rules cannot be deleted",
      status: 403,
    });
    expect(prisma.alertRule.updateMany).not.toHaveBeenCalled();
  });
});

describe("pruneDestinationIdFromAlertRules", () => {
  it("removes the destination id from destinationIds", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = {
      alertRule: {
        findMany: async () => [
          {
            id: "rule-1",
            source: "CUSTOM",
            destination_ids: [
              PROJECT_EMAIL_DESTINATION_ID,
              "22222222-2222-2222-2222-222222222222",
              "33333333-3333-3333-3333-333333333333",
            ],
          },
          {
            id: "rule-2",
            source: "CUSTOM",
            destination_ids: [],
          },
          {
            id: "sys-1",
            source: "SYSTEM",
            destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
          },
        ],
        update,
      },
    } as never;

    const n = await pruneDestinationIdFromAlertRules(
      prisma,
      "p1",
      "22222222-2222-2222-2222-222222222222"
    );
    expect(n).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: {
        destination_ids: [
          PROJECT_EMAIL_DESTINATION_ID,
          "33333333-3333-3333-3333-333333333333",
        ],
      },
    });
  });
});

describe("maybeEvaluateAlertRules (ingest)", () => {
  beforeEach(() => {
    fireProjectAlert.mockClear();
    fireProjectAlert.mockResolvedValue(true);
    loadPlanContextForProject.mockClear();
    getMonthlyIngestUsed.mockClear();
  });

  it("fires when all AND conditions match with destination binding", async () => {
    const ruleRow = {
      id: "rule-1",
      name: "Prod errors",
      enabled: true,
      conditions: [
        {
          type: "ERROR_COUNT" as const,
          threshold: 5,
          windowMinutes: 15,
          environment: "production",
        },
      ],
      destination_ids: ["22222222-2222-2222-2222-222222222222"],
      cooldown_minutes: 15,
      created_at: new Date("2026-07-17T00:00:00.000Z"),
      updated_at: new Date("2026-07-17T00:00:00.000Z"),
    };
    const count = vi.fn(async () => 12);
    const prisma = {
      alertRule: {
        findMany: async () => [ruleRow],
        updateMany: claimAlways(),
      },
      errorOccurrence: { count },
    } as never;

    await maybeEvaluateAlertRules(prisma, "p1");

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        environment: "production",
        error_group: { project_id: "p1" },
      }),
    });
    expect(fireProjectAlert).toHaveBeenCalledTimes(1);
    expect(fireProjectAlert).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        projectId: "p1",
        rule: "ALERT_RULE",
        title: "Prod errors",
        destinations: {
          email: false,
          webhookIds: ["22222222-2222-2222-2222-222222222222"],
        },
      })
    );
  });

  it("skips unknown condition types and still evaluates remaining AND conditions", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ruleRow = {
      id: "rule-1",
      name: "Mixed",
      enabled: true,
      conditions: [
        {
          type: "ERROR_COUNT",
          threshold: 2,
          windowMinutes: 15,
          environment: null,
        },
        { type: "UNKNOWN_FUTURE", threshold: 1 },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prisma = {
      alertRule: {
        findMany: async () => [ruleRow],
        updateMany: claimAlways(),
      },
      errorOccurrence: { count: async () => 5 },
    } as never;

    await maybeEvaluateAlertRules(prisma, "p1");
    expect(fireProjectAlert).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not fire when cooldown claim loses (concurrent / still cooling)", async () => {
    const ruleRow = {
      id: "rule-1",
      name: "Prod errors",
      enabled: true,
      conditions: [
        {
          type: "ERROR_COUNT" as const,
          threshold: 5,
          windowMinutes: 15,
          environment: null,
        },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prisma = {
      alertRule: {
        findMany: async () => [ruleRow],
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      errorOccurrence: { count: async () => 12 },
    } as never;

    await maybeEvaluateAlertRules(prisma, "p1");
    expect(fireProjectAlert).not.toHaveBeenCalled();
  });

  it("does not fire when no supported conditions remain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = {
      alertRule: {
        findMany: async () => [
          {
            id: "rule-unknown",
            name: "Only unknown",
            enabled: true,
            conditions: [{ type: "UNKNOWN_FUTURE", threshold: 1 }],
            destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
            cooldown_minutes: 15,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      },
      errorOccurrence: { count: vi.fn(async () => 100) },
    } as never;

    await maybeEvaluateAlertRules(prisma, "p1");
    expect(fireProjectAlert).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips schedule-only rules on the ingest path", async () => {
    const prisma = {
      alertRule: {
        findMany: async () => [
          {
            id: "rule-hb",
            name: "Heartbeat",
            enabled: true,
            conditions: [
              { type: "HEARTBEAT", windowMinutes: 15, environment: null },
            ],
            destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
            cooldown_minutes: 15,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      },
      event: { count: vi.fn(async () => 0) },
      session: { count: vi.fn(async () => 0) },
      errorOccurrence: { count: vi.fn(async () => 0) },
    } as never;

    await maybeEvaluateAlertRules(prisma, "p1");
    expect(fireProjectAlert).not.toHaveBeenCalled();
  });

  it("skips disabled rules and below-threshold counts", async () => {
    const prisma = {
      alertRule: {
        findMany: async () => [
          {
            id: "rule-off",
            name: "Off",
            enabled: false,
            conditions: [
              {
                type: "ERROR_COUNT",
                threshold: 1,
                windowMinutes: 15,
                environment: null,
              },
            ],
            destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
            cooldown_minutes: 15,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: "rule-low",
            name: "Low",
            enabled: true,
            conditions: [
              {
                type: "ERROR_COUNT",
                threshold: 100,
                windowMinutes: 15,
                environment: null,
              },
            ],
            destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
            cooldown_minutes: 15,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      },
      errorOccurrence: {
        count: async () => 2,
      },
    } as never;

    await maybeEvaluateAlertRules(prisma, "p1");
    expect(fireProjectAlert).not.toHaveBeenCalled();
  });
});

describe("runScheduledAlertRuleEvaluation", () => {
  beforeEach(() => {
    fireProjectAlert.mockClear();
    fireProjectAlert.mockResolvedValue(true);
    loadPlanContextForProject.mockClear();
    getMonthlyIngestUsed.mockClear();
    loadPlanContextForProject.mockResolvedValue({
      planTier: "PRO",
      limits: { monthlyIngestUnits: 1000 },
    });
    getMonthlyIngestUsed.mockResolvedValue(900);
  });

  it("evaluates HEARTBEAT / QUOTA_PERCENT rules and fires via Notifications", async () => {
    const heartbeatRule = {
      id: "rule-hb",
      name: "Silence",
      enabled: true,
      conditions: [
        { type: "HEARTBEAT" as const, windowMinutes: 15, environment: null },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const quotaRule = {
      id: "rule-q",
      name: "Quota",
      enabled: true,
      conditions: [{ type: "QUOTA_PERCENT" as const, thresholdPercent: 80 }],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const errorOnlyRule = {
      id: "rule-err",
      name: "Errors",
      enabled: true,
      conditions: [
        {
          type: "ERROR_COUNT" as const,
          threshold: 1,
          windowMinutes: 15,
          environment: null,
        },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const prisma = {
      alertRule: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ project_id: "p1" }])
          .mockResolvedValueOnce([heartbeatRule, quotaRule, errorOnlyRule]),
        updateMany: claimAlways(),
      },
      project: { findFirst: async () => ({ id: "p1" }) },
      event: { count: async () => 0 },
      session: { count: async () => 0 },
      errorOccurrence: { count: async () => 0 },
    } as never;

    const result = await runScheduledAlertRuleEvaluation(prisma);
    expect(result.projectsScanned).toBe(1);
    expect(result.rulesEvaluated).toBe(2);
    expect(result.rulesFired).toBe(2);
    expect(fireProjectAlert).toHaveBeenCalledTimes(2);
    expect(fireProjectAlert).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        rule: "ALERT_RULE",
        title: "Silence",
        href: "/dashboard/overview?range=24h",
      })
    );
    expect(fireProjectAlert).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        rule: "ALERT_RULE",
        title: "Quota",
        href: "/dashboard/settings/billing",
      })
    );
  });

  it("continues the sweep when one scheduled rule fails to fire", async () => {
    const failing = {
      id: "rule-fail",
      name: "Failing",
      enabled: true,
      conditions: [
        { type: "NO_EVENTS" as const, windowMinutes: 5, environment: null },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const ok = {
      id: "rule-ok",
      name: "Still runs",
      enabled: true,
      conditions: [
        { type: "NO_EVENTS" as const, windowMinutes: 5, environment: null },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    fireProjectAlert.mockRejectedValueOnce(new Error("Response from the Engine was empty"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prisma = {
      alertRule: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ project_id: "p1" }])
          .mockResolvedValueOnce([failing, ok]),
        updateMany: claimAlways(),
      },
      project: { findFirst: async () => ({ id: "p1" }) },
      event: { count: async () => 0 },
    } as never;

    const result = await runScheduledAlertRuleEvaluation(prisma);
    expect(result.rulesEvaluated).toBe(2);
    expect(result.rulesFired).toBe(1);
    expect(fireProjectAlert).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
    fireProjectAlert.mockResolvedValue(true);
  });

  it("fires NO_EVENTS on the scheduled path when the window is empty", async () => {
    const ruleRow = {
      id: "rule-ne",
      name: "No events",
      enabled: true,
      conditions: [
        { type: "NO_EVENTS" as const, windowMinutes: 5, environment: null },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prisma = {
      alertRule: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ project_id: "p1" }])
          .mockResolvedValueOnce([ruleRow]),
        updateMany: claimAlways(),
      },
      project: { findFirst: async () => ({ id: "p1" }) },
      event: { count: async () => 0 },
    } as never;

    const result = await runScheduledAlertRuleEvaluation(prisma);
    expect(result.rulesEvaluated).toBe(1);
    expect(result.rulesFired).toBe(1);
    expect(fireProjectAlert).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        rule: "ALERT_RULE",
        title: "No events",
        href: "/dashboard/overview?range=24h",
      })
    );
  });

  it("does not evaluate schedule-only rules on error ingest", async () => {
    const ruleRow = {
      id: "rule-ne",
      name: "No events",
      enabled: true,
      conditions: [
        { type: "NO_EVENTS" as const, windowMinutes: 5, environment: null },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const count = vi.fn(async () => 0);
    const prisma = {
      alertRule: {
        findMany: async () => [ruleRow],
        updateMany: claimAlways(),
      },
      event: { count },
    } as never;

    const result = await evaluateAlertRulesForProject(prisma, "p1", "ingest");
    expect(result.evaluated).toBe(0);
    expect(result.fired).toBe(0);
    expect(count).not.toHaveBeenCalled();
    expect(fireProjectAlert).not.toHaveBeenCalled();
  });

  it("does not fire NO_EVENTS when events exist", async () => {
    const ruleRow = {
      id: "rule-ne",
      name: "No events",
      enabled: true,
      conditions: [
        { type: "NO_EVENTS" as const, windowMinutes: 15, environment: null },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prisma = {
      alertRule: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ project_id: "p1" }])
          .mockResolvedValueOnce([ruleRow]),
        updateMany: claimAlways(),
      },
      project: { findFirst: async () => ({ id: "p1" }) },
      event: { count: async () => 3 },
    } as never;

    const result = await runScheduledAlertRuleEvaluation(prisma);
    expect(result.rulesEvaluated).toBe(1);
    expect(result.rulesFired).toBe(0);
    expect(fireProjectAlert).not.toHaveBeenCalled();
  });

  it("skips projects whose organization is soft-deleted (ingest parity)", async () => {
    const findFirst = vi.fn(async () => null);
    const prisma = {
      alertRule: {
        findMany: vi.fn().mockResolvedValueOnce([{ project_id: "p-archived" }]),
        updateMany: claimAlways(),
      },
      project: { findFirst },
      event: { count: vi.fn(async () => 0) },
      session: { count: vi.fn(async () => 0) },
      errorOccurrence: { count: vi.fn(async () => 0) },
    } as never;

    const result = await runScheduledAlertRuleEvaluation(prisma);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "p-archived",
        deleted_at: null,
        organization: { deleted_at: null },
      },
      select: { id: true },
    });
    expect(result.projectsScanned).toBe(1);
    expect(result.rulesEvaluated).toBe(0);
    expect(result.rulesFired).toBe(0);
    expect(fireProjectAlert).not.toHaveBeenCalled();
    // findMany for rules is never reached when the project/org gate fails.
    expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("evaluateAlertRulesForProject SESSION_DROP / ERROR_RATE", () => {
  beforeEach(() => {
    fireProjectAlert.mockClear();
    fireProjectAlert.mockResolvedValue(true);
  });

  it("fires SESSION_DROP when the current window is below the previous window", async () => {
    const ruleRow = {
      id: "rule-sd",
      name: "Drop",
      enabled: true,
      conditions: [
        {
          type: "SESSION_DROP" as const,
          dropPercent: 50,
          windowMinutes: 60,
          environment: null,
        },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const sessionCount = vi
      .fn()
      .mockResolvedValueOnce(10) // current
      .mockResolvedValueOnce(40); // previous
    const prisma = {
      alertRule: {
        findMany: async () => [ruleRow],
        updateMany: claimAlways(),
      },
      session: { count: sessionCount },
    } as never;

    const result = await evaluateAlertRulesForProject(prisma, "p1", "scheduled");
    expect(result.fired).toBe(1);
    expect(fireProjectAlert).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        title: "Drop",
        href: "/dashboard/sessions",
      })
    );
  });

  it("fires ERROR_RATE when errors/sessions exceeds threshold", async () => {
    const ruleRow = {
      id: "rule-er",
      name: "Rate",
      enabled: true,
      conditions: [
        {
          type: "ERROR_RATE" as const,
          thresholdPercent: 10,
          windowMinutes: 15,
          environment: null,
        },
      ],
      destination_ids: [PROJECT_EMAIL_DESTINATION_ID],
      cooldown_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prisma = {
      alertRule: {
        findMany: async () => [ruleRow],
        updateMany: claimAlways(),
      },
      errorOccurrence: { count: async () => 5 },
      session: { count: async () => 10 },
    } as never;

    const result = await evaluateAlertRulesForProject(prisma, "p1", "ingest");
    expect(result.fired).toBe(1);
    expect(fireProjectAlert).toHaveBeenCalledTimes(1);
  });
});
