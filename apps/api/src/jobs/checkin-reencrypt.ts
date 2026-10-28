/**
 * Re-encrypt CheckInMonitor.token_encrypted with the current CHECKIN_ENCRYPTION_KEY.
 * Idempotent: rows already on the current key are skipped. Logs counts only.
 */
import type { PrismaClient } from "@prisma/client";
import { checkInTokenHash, decryptCheckInSecret, encryptCheckInToken, isEncryptedWithCurrentKey } from "../lib/checkin-secrets.js";

export type CheckInReencryptResult = {
  dryRun: boolean; scanned: number; alreadyCurrent: number; reencrypted: number; failed: number;
};

type Db = Pick<PrismaClient, "checkInMonitor">;

export function parseCheckInReencryptArgs(argv: string[]): { apply: boolean; batchSize: number; help: boolean; error?: string } {
  let apply = false, batchSize = 200, help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--batch-size") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 2000) return { apply, batchSize, help, error: "--batch-size must be 1..2000" };
      batchSize = n;
    } else if (a !== "--") return { apply, batchSize, help, error: `Unknown argument: ${a}` };
  }
  return { apply, batchSize, help };
}

export async function runCheckInReencrypt(db: Db, opts: { apply?: boolean; batchSize?: number } = {}): Promise<CheckInReencryptResult> {
  const apply = opts.apply === true;
  const batchSize = opts.batchSize ?? 200;
  const result: CheckInReencryptResult = { dryRun: !apply, scanned: 0, alreadyCurrent: 0, reencrypted: 0, failed: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.checkInMonitor.findMany({
      select: { id: true, token_hash: true, token_encrypted: true },
      orderBy: { id: "asc" }, take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.scanned++;
      if (isEncryptedWithCurrentKey(row.token_encrypted)) {
        try { decryptCheckInSecret(row.token_encrypted); result.alreadyCurrent++; } catch { result.failed++; }
        continue;
      }
      let token: string;
      try { token = decryptCheckInSecret(row.token_encrypted); } catch { result.failed++; continue; }
      if (checkInTokenHash(token) !== row.token_hash) { result.failed++; continue; }
      if (apply) {
        // Compare-and-set so a concurrent token rotation is never overwritten.
        const updated = await db.checkInMonitor.updateMany({
          where: { id: row.id, token_encrypted: row.token_encrypted },
          data: { token_encrypted: encryptCheckInToken(token) },
        });
        if (updated.count === 1) result.reencrypted++;
      } else {
        result.reencrypted++;
      }
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }
  return result;
}
