import type { PrismaClient } from "@prisma/client";
import {
  resolveAlertRulesScheduleIntervalMinutes,
  runScheduledAlertRuleEvaluation,
  type ScheduledAlertRuleEvaluationResult,
} from "../lib/alert-rules.js";
import {
  isTransactionalEmailConfigured,
  warnIfTransactionalEmailNotConfigured,
} from "../lib/email.js";

export type AlertRulesEvaluatorSweepResult = ScheduledAlertRuleEvaluationResult & {
  intervalMinutes: number;
  /**
   * Whether *this process* can send Resend mail. Independent of rule evaluation
   * success — a sweep can fire alerts and still report `email: "unavailable"`.
   */
  email: "configured" | "unavailable";
};

/**
 * One scheduled evaluation tick. Safe to re-run: cooldown dedupe makes fires idempotent
 * within each rule's cooldown window.
 */
export const ALERT_RULES_EVALUATOR_JOB = "alert-rules-evaluator";

export async function recordAlertRulesEvaluatorHeartbeat(
  prisma: PrismaClient,
  at: Date = new Date()
): Promise<void> {
  await prisma.scheduledJobHeartbeat.upsert({
    where: { job: ALERT_RULES_EVALUATOR_JOB },
    create: { job: ALERT_RULES_EVALUATOR_JOB, last_ok_at: at },
    update: { last_ok_at: at },
  });
}

export async function runAlertRulesEvaluatorSweep(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlertRulesEvaluatorSweepResult> {
  const intervalMinutes = resolveAlertRulesScheduleIntervalMinutes(env);
  const emailConfigured = isTransactionalEmailConfigured(env);
  if (!emailConfigured) {
    warnIfTransactionalEmailNotConfigured(env, { job: ALERT_RULES_EVALUATOR_JOB });
  }
  const result = await runScheduledAlertRuleEvaluation(prisma);
  await recordAlertRulesEvaluatorHeartbeat(prisma);
  return {
    ...result,
    intervalMinutes,
    email: emailConfigured ? "configured" : "unavailable",
  };
}
