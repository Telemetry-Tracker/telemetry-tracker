/**
 * Best-effort visitor IP for server actions, used only as a rate-limit key that the dashboard
 * forwards to the API (`x-tt-client-ip`). Never stored, never used for fingerprinting.
 * Prefers `x-real-ip` (set by the edge proxy), then the first `x-forwarded-for` hop.
 */
import { isIP } from "node:net";

export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const candidates = [
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0] ?? null,
  ];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value && value.length <= 45 && isIP(value) !== 0) return value;
  }
  return null;
}
