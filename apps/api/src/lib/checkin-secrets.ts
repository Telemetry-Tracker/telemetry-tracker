import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function checkInTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function encryptionKey(): Buffer {
  const raw = process.env.CHECKIN_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("CHECKIN_ENCRYPTION_KEY must be 32 bytes in hex");
  return Buffer.from(raw, "hex");
}
export function createCheckInSecret() {
  const token = `ttc_${randomBytes(32).toString("hex")}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    token_hash: checkInTokenHash(token),
    token_encrypted: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64"),
  };
}
export function decryptCheckInSecret(encrypted: string): string {
  const bytes = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
export function redactCheckInSecrets(text: string): string {
  return text.replace(/ttc_[a-zA-Z0-9_%.-]+/g, "[redacted]")
    .replace(/(\/checkin\/)[^\s/?#"<>]+/gi, "$1[redacted]");
}
