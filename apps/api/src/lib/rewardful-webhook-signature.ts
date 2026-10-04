/**
 * Rewardful webhook signature verification using HMAC-SHA256.
 * Implements constant-time comparison to prevent timing attacks.
 */
import crypto from "node:crypto";

/**
 * Verify Rewardful webhook signature (HMAC-SHA256).
 * Returns true if signature is valid.
 * 
 * Rewardful sends signature in X-Rewardful-Signature header as hex-encoded HMAC-SHA256.
 */
export function verifyRewardfulSignature(
  payload: Buffer | string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    // Length mismatch or invalid hex
    return false;
  }
}
