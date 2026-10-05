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

  // Validate hex format before decoding
  // Reject if signature doesn't match exactly 64 hex characters
  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  // timingSafeEqual will throw if lengths don't match
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    // Length mismatch or invalid hex (shouldn't happen after validation above)
    return false;
  }
}
