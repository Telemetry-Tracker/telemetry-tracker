import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { checkInTokenHash, createCheckInSecret, decryptCheckInSecret, isEncryptedWithCurrentKey } from "./checkin-secrets.js";
import { parseCheckInReencryptArgs, runCheckInReencrypt } from "../jobs/checkin-reencrypt.js";

const OLD = "ab".repeat(32), NEW = "cd".repeat(32), OTHER = "ef".repeat(32);
afterEach(() => vi.unstubAllEnvs());

/** Legacy (pre-rotation) format: bare base64(iv|tag|ct). */
function legacyEncrypt(keyHex: string, token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function setKeys(current: string, previous?: string) {
  vi.stubEnv("CHECKIN_ENCRYPTION_KEY", current);
  vi.stubEnv("CHECKIN_ENCRYPTION_KEY_PREVIOUS", previous ?? "");
}
function fakeDb(rows: { id: string; token_hash: string; token_encrypted: string }[]) {
  return {
    checkInMonitor: {
      findMany: vi.fn(async (args: { take: number; cursor?: { id: string } }) => {
        const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
        const start = args.cursor ? sorted.findIndex((r) => r.id === args.cursor!.id) + 1 : 0;
        return sorted.slice(start, start + args.take).map((r) => ({ ...r }));
      }),
      updateMany: vi.fn(async (args: { where: { id: string; token_encrypted: string }; data: { token_encrypted: string } }) => {
        const r = rows.find((x) => x.id === args.where.id && x.token_encrypted === args.where.token_encrypted);
        if (!r) return { count: 0 };
        r.token_encrypted = args.data.token_encrypted; return { count: 1 };
      }),
    },
  };
}

describe("check-in encryption key rotation", () => {
  it("decrypts legacy and versioned old-key data after rotation", () => {
    setKeys(OLD);
    const versioned = createCheckInSecret().token_encrypted;
    const legacy = legacyEncrypt(OLD, "ttc_legacy");
    setKeys(NEW, `${OTHER}, ${OLD}`);
    expect(decryptCheckInSecret(legacy)).toBe("ttc_legacy");
    expect(decryptCheckInSecret(versioned)).toMatch(/^ttc_/);
    expect(isEncryptedWithCurrentKey(versioned)).toBe(false);
  });
  it("encrypts new writes with the current key only", () => {
    setKeys(NEW, OLD);
    const enc = createCheckInSecret().token_encrypted;
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain(NEW);
    expect(isEncryptedWithCurrentKey(enc)).toBe(true);
    setKeys(NEW);
    expect(decryptCheckInSecret(enc)).toMatch(/^ttc_/);
    setKeys(OLD);
    expect(() => decryptCheckInSecret(enc)).toThrow("could not be decrypted");
  });
  it("fails safely without the previous key and rejects malformed previous keys", () => {
    const legacy = legacyEncrypt(OLD, "ttc_x");
    setKeys(NEW);
    expect(() => decryptCheckInSecret(legacy)).toThrow("could not be decrypted");
    setKeys(NEW, "not-hex");
    expect(() => decryptCheckInSecret(legacy)).toThrow("CHECKIN_ENCRYPTION_KEY_PREVIOUS");
    setKeys("", OLD);
    expect(() => createCheckInSecret()).toThrow("CHECKIN_ENCRYPTION_KEY");
  });
  it("re-encrypt is dry-run by default, migrates with --apply and is idempotent", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => {
      const token = `ttc_${i}`;
      return { id: `m${i}`, token_hash: checkInTokenHash(token), token_encrypted: legacyEncrypt(OLD, token) };
    });
    setKeys(NEW, OLD);
    const db = fakeDb(rows);
    const log = vi.spyOn(console, "log");
    const dry = await runCheckInReencrypt(db as never, { batchSize: 2 });
    expect(dry).toEqual({ dryRun: true, scanned: 5, alreadyCurrent: 0, reencrypted: 5, failed: 0 });
    expect(db.checkInMonitor.updateMany).not.toHaveBeenCalled();
    const applied = await runCheckInReencrypt(db as never, { apply: true, batchSize: 2 });
    expect(applied).toMatchObject({ dryRun: false, scanned: 5, reencrypted: 5, failed: 0 });
    const again = await runCheckInReencrypt(db as never, { apply: true, batchSize: 2 });
    expect(again).toMatchObject({ scanned: 5, alreadyCurrent: 5, reencrypted: 0, failed: 0 });
    setKeys(NEW);
    rows.forEach((r, i) => expect(decryptCheckInSecret(r.token_encrypted)).toBe(`ttc_${i}`));
    expect(log).not.toHaveBeenCalled();
  });
  it("re-encrypt counts undecryptable rows as failed and leaves them unchanged", async () => {
    const row = { id: "m1", token_hash: checkInTokenHash("ttc_a"), token_encrypted: legacyEncrypt(OLD, "ttc_a") };
    setKeys(NEW);
    const before = row.token_encrypted;
    const r = await runCheckInReencrypt(fakeDb([row]) as never, { apply: true });
    expect(r).toMatchObject({ failed: 1, reencrypted: 0 });
    expect(row.token_encrypted).toBe(before);
  });
  it("parses CLI args with dry-run default", () => {
    expect(parseCheckInReencryptArgs([])).toMatchObject({ apply: false, batchSize: 200 });
    expect(parseCheckInReencryptArgs(["--apply", "--batch-size", "50"])).toMatchObject({ apply: true, batchSize: 50 });
    expect(parseCheckInReencryptArgs(["--nope"]).error).toBeTruthy();
  });
});
