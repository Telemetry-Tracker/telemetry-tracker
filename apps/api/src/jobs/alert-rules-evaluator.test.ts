import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTransactionalEmailConfigWarningForTests } from "../lib/email.js";

const runScheduledAlertRuleEvaluation = vi.fn(async () => ({
  projectsScanned: 2,
  rulesEvaluated: 3,
  rulesFired: 1,
}));

vi.mock("../lib/alert-rules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/alert-rules.js")>();
  return {
    ...actual,
    runScheduledAlertRuleEvaluation: (...args: unknown[]) =>
      runScheduledAlertRuleEvaluation(...args),
  };
});

import { runAlertRulesEvaluatorSweep } from "./alert-rules-evaluator.js";

describe("runAlertRulesEvaluatorSweep", () => {
  beforeEach(() => {
    runScheduledAlertRuleEvaluation.mockClear();
    resetTransactionalEmailConfigWarningForTests();
  });

  it("runs scheduled evaluation, records a heartbeat, and reports email availability", async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = { scheduledJobHeartbeat: { upsert } } as never;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await runAlertRulesEvaluatorSweep(prisma, {
      ALERT_RULES_SCHEDULE_INTERVAL_MINUTES: "10",
    });
    expect(runScheduledAlertRuleEvaluation).toHaveBeenCalledWith(prisma);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { job: "alert-rules-evaluator" },
      })
    );
    expect(result).toEqual({
      projectsScanned: 2,
      rulesEvaluated: 3,
      rulesFired: 1,
      intervalMinutes: 10,
      email: "unavailable",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("email_not_configured")
    );
    warnSpy.mockRestore();
  });

  it("reports email configured when Resend env is present on the evaluator process", async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = { scheduledJobHeartbeat: { upsert } } as never;
    const result = await runAlertRulesEvaluatorSweep(prisma, {
      ALERT_RULES_SCHEDULE_INTERVAL_MINUTES: "5",
      RESEND_API_KEY: "re_test",
      TELEMETRY_EMAIL_FROM: "Telemetry <noreply@example.com>",
    });
    expect(result.email).toBe("configured");
    expect(result.intervalMinutes).toBe(5);
  });
});
