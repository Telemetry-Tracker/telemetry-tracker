/**
 * Public affiliate codes: unique, case-insensitive, never internal IDs.
 */

export const AFFILIATE_CODE_MIN_LEN = 2;
export const AFFILIATE_CODE_MAX_LEN = 64;
export const AFFILIATE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeAffiliateCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidAffiliateCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < AFFILIATE_CODE_MIN_LEN || trimmed.length > AFFILIATE_CODE_MAX_LEN) {
    return false;
  }
  if (!AFFILIATE_CODE_RE.test(trimmed)) return false;
  // Do not expose or accept internal UUIDs as public codes.
  if (UUID_RE.test(trimmed)) return false;
  return true;
}

export function parseAffiliateCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!isValidAffiliateCode(raw)) return null;
  return normalizeAffiliateCode(raw);
}

/** Slug a display name into a candidate code (caller must ensure uniqueness). */
export function slugifyAffiliateCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AFFILIATE_CODE_MAX_LEN);
  if (isValidAffiliateCode(slug)) return slug;
  return "aff";
}
