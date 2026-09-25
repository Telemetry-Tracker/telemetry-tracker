/**
 * CLI: `pnpm --filter api alert-rules-evaluator [-- --loop]`
 * Requires `DATABASE_URL`. Intended for cron / scheduled jobs (#534).
 *
 * Default: one sweep then exit (Railway cron).
 * `--loop`: long-lived worker sleeping `ALERT_RULES_SCHEDULE_INTERVAL_MINUTES` between ticks.
 */
import { prisma } from "../lib/db.js";
import { resolveAlertRulesScheduleIntervalMinutes } from "../lib/alert-rules.js";
import { runAlertRulesEvaluatorSweep } from "./alert-rules-evaluator.js";

const LOOP = process.argv.includes("--loop");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: pnpm --filter api alert-rules-evaluator [-- --loop]

Options:
  --loop      Keep running, sleeping between sweeps
  --help, -h  Show this help

Environment:
  DATABASE_URL
  ALERT_RULES_SCHEDULE_INTERVAL_MINUTES  (default 5; used by --loop and logged on each sweep)
  RESEND_API_KEY + TELEMETRY_EMAIL_FROM  (both required for alert emails from this process)
  TELEMETRY_DASHBOARD_ORIGIN             (email links; DASHBOARD_ORIGIN is not read here)
  NODE_ENV=production                    (recommended on Railway)

Production cron (after build): node dist/jobs/run-alert-rules-evaluator.js
Recommended cron: every 5 minutes (see ALERT_RULES_SCHEDULE_INTERVAL_MINUTES).
`);
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  while (true) {
    const result = await runAlertRulesEvaluatorSweep(prisma);
    console.log(
      JSON.stringify({
        ok: true,
        job: "alert-rules-evaluator",
        ...result,
        at: new Date().toISOString(),
      })
    );
    if (!LOOP) break;
    const intervalMinutes = resolveAlertRulesScheduleIntervalMinutes();
    await sleep(intervalMinutes * 60 * 1000);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
