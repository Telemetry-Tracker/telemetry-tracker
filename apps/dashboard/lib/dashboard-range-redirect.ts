import { DEFAULT_DASHBOARD_TIME_RANGE, hasExplicitTimeRangeQuery } from "./time-range";

/**
 * List pages that call `redirect()` when `range` is missing. That redirect runs
 * after the dashboard shell has rendered `useSearchParams()`, which throws
 * React #310 ("Rendered more hooks than during the previous render") and
 * flashes the Next.js application error. Canonicalize in middleware first.
 */
const RANGE_CANONICAL_PATHS = new Set([
  "/dashboard",
  "/dashboard/overview",
  "/dashboard/visits",
  "/dashboard/releases",
  "/dashboard/search",
  "/dashboard/performance",
  "/dashboard/events",
  "/dashboard/sessions",
  "/dashboard/errors",
]);

export function dashboardRangeCanonicalHref(
  pathname: string,
  search: string
): string | null {
  if (!RANGE_CANONICAL_PATHS.has(pathname)) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (
    hasExplicitTimeRangeQuery({
      range: params.get("range") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    })
  ) {
    return null;
  }
  params.set("range", DEFAULT_DASHBOARD_TIME_RANGE);
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}
