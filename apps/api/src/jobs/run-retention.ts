/**
 * CLI: `pnpm --filter api retention [-- --dry-run]`
 * Requires `DATABASE_URL`. Intended for cron / scheduled jobs.
 */
import { prisma } from "../lib/db.js";
import { runRetentionSweep } from "./retention.js";

const DRY_RUN = process.argv.includes("--dry-run");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: pnpm --filter api retention [-- --dry-run]

Options:
  --dry-run   Count rows that would be pruned without deleting
  --help, -h  Show this help

Production cron (after build): node dist/jobs/run-retention.js
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const result = await runRetentionSweep(prisma, { dryRun: DRY_RUN });
  console.log(
    JSON.stringify({ ok: true, dryRun: DRY_RUN, ...result, at: new Date().toISOString() })
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
