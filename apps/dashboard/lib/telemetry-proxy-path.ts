const ALLOWED_ROOTS = new Set(["sessions", "events", "errors"]);
const ALLOWED_PAIRS = new Set([
  "sessions/analytics",
  "events/analytics",
  "errors/analytics",
  "sessions/summary",
  "performance/summary",
]);
const SAFE_SEGMENT_RE = /^[a-z]+$/;

/** Paths the dashboard browser may proxy to the API. Keep this list tight. */
export function isAllowedTelemetryProxyPath(path: string[]): boolean {
  if (path.length === 0 || path.some((segment) => !SAFE_SEGMENT_RE.test(segment))) {
    return false;
  }
  if (path.length === 1) {
    return ALLOWED_ROOTS.has(path[0]!);
  }
  if (path.length === 2) {
    return ALLOWED_PAIRS.has(`${path[0]}/${path[1]}`);
  }
  return false;
}
