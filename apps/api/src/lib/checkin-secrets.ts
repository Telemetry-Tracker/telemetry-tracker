import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function checkInTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Encryption keys for check-in tokens.
 * - CHECKIN_ENCRYPTION_KEY: current key (32 bytes hex), used for all new encryption.
 * - CHECKIN_ENCRYPTION_KEY_PREVIOUS: optional comma-separated old keys, decryption only.
 * Ciphertext format: `v1.<kid>.<base64(iv|tag|ct)>` where kid is a short SHA-256 fingerprint
 * of the key (not the key). Legacy rows are bare base64 and are tried against every key;
 * AES-256-GCM authentication rejects a wrong key.
 */
type CheckInKey = { id: string; key: Buffer };
const KEY_RE = /^[a-f0-9]{64}$/i;
const PREFIX = "v1.";

function toKey(raw: string): CheckInKey {
  const key = Buffer.from(raw, "hex");
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 16), key };
}
function currentKey(): CheckInKey {
  const raw = (process.env.CHECKIN_ENCRYPTION_KEY ?? "").trim();
  if (!KEY_RE.test(raw)) throw new Error("CHECKIN_ENCRYPTION_KEY must be 32 bytes in hex");
  return toKey(raw);
}
function previousKeys(): CheckInKey[] {
  const raw = process.env.CHECKIN_ENCRYPTION_KEY_PREVIOUS ?? "";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!KEY_RE.test(p)) throw new Error("CHECKIN_ENCRYPTION_KEY_PREVIOUS must be comma-separated 32-byte hex keys");
  }
  return parts.map(toKey);
}
/** Current key first, then previous keys (deduplicated). */
function decryptionKeys(): CheckInKey[] {
  const keys = [currentKey(), ...previousKeys()];
  return keys.filter((k, i) => keys.findIndex((o) => o.id === k.id) === i);
}

function encryptWith(k: CheckInKey, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${PREFIX}${k.id}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}
function decryptWith(k: CheckInKey, payload: string): string {
  const bytes = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", k.key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
function parse(encrypted: string): { kid: string | null; payload: string } {
  if (encrypted.startsWith(PREFIX)) {
    const rest = encrypted.slice(PREFIX.length);
    const dot = rest.indexOf(".");
    if (dot > 0) return { kid: rest.slice(0, dot), payload: rest.slice(dot + 1) };
  }
  return { kid: null, payload: encrypted };
}

export function encryptCheckInToken(token: string): string {
  return encryptWith(currentKey(), token);
}
export function createCheckInSecret() {
  const token = `ttc_${randomBytes(32).toString("hex")}`;
  return { token_hash: checkInTokenHash(token), token_encrypted: encryptCheckInToken(token) };
}
export function decryptCheckInSecret(encrypted: string): string {
  const { kid, payload } = parse(encrypted);
  const keys = decryptionKeys();
  const ordered = kid ? [...keys.filter((k) => k.id === kid), ...keys.filter((k) => k.id !== kid)] : keys;
  for (const k of ordered) {
    try { return decryptWith(k, payload); } catch { /* wrong key or tampered: try next */ }
  }
  throw new Error("Check-in secret could not be decrypted with the configured keys");
}
/** True when the value is already encrypted with the current key (versioned format). */
export function isEncryptedWithCurrentKey(encrypted: string): boolean {
  return parse(encrypted).kid === currentKey().id;
}
export function redactCheckInSecrets(text: string): string {
  return text.replace(/ttc_[a-zA-Z0-9_%.-]+/g, "[redacted]")
    .replace(/(\/checkin\/)[^\s/?#"<>]+/gi, "$1[redacted]");
}
