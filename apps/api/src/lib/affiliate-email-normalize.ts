/**
 * Email normalization for self-referral checks.
 * Handles +tags and Gmail dots to prevent trivial self-referral evasion.
 */

/**
 * Normalize email for self-referral comparison:
 * - lowercase
 * - strip +tag from local part
 * - remove dots from Gmail addresses
 */
export function normalizeEmailForSelfReferralCheck(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) {
    // Invalid email, return as-is
    return trimmed;
  }

  let localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  // Strip +tag from local part (everything after first +)
  const plusIndex = localPart.indexOf("+");
  if (plusIndex >= 0) {
    localPart = localPart.slice(0, plusIndex);
  }

  // Remove dots from Gmail addresses (gmail.com and googlemail.com)
  if (domain === "gmail.com" || domain === "googlemail.com") {
    localPart = localPart.replace(/\./g, "");
    return `${localPart}@gmail.com`;
  }

  return `${localPart}@${domain}`;
}
