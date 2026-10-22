/**
 * CLI: re-encrypt check-in tokens with the current CHECKIN_ENCRYPTION_KEY.
 *
 *   node dist/jobs/run-checkin-reencrypt.js            # dry run (default)
 *   node dist/jobs/run-checkin-reencrypt.js --apply    # write
 *
 * Requires DATABASE_URL, CHECKIN_ENCRYPTION_KEY and (during rotation) CHECKIN_ENCRYPTION_KEY_PREVIOUS.
 * Prints counts only; never prints tokens or keys.
 */
import { prisma } from "../lib/db.js";
import { parseCheckInReencryptArgs, runCheckInReencrypt } from "./checkin-reencrypt.js";

const parsed = parseCheckInReencryptArgs(process.argv.slice(2));
if (parsed.help) {
  console.log("Usage: node dist/jobs/run-checkin-reencrypt.js [--apply] [--batch-size <n>]\nDry run by default. Idempotent. See docs/CHECK-INS.md (key rotation).");
  process.exit(0);
}
if (parsed.error) { console.error(parsed.error); process.exit(1); }

runCheckInReencrypt(prisma, { apply: parsed.apply, batchSize: parsed.batchSize })
  .then(async (result) => {
    console.log(JSON.stringify({ ok: result.failed === 0, ...result, at: new Date().toISOString() }));
    await prisma.$disconnect();
    if (result.failed > 0) process.exit(1);
  })
  .catch(async (e: unknown) => {
    console.error(`[checkin-reencrypt] failed: ${e instanceof Error ? e.message : "unknown error"}`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
