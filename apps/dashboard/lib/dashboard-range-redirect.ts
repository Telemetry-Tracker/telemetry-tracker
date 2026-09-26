import { DEFAULT_DASHBOARD_TIME_RANGE, hasExplicitTimeRangeQuery } from "./time-range";

/**
 * List pages that call `redirect()` when `range` is missing. That redirect runs
 * after the dashboard shell has rendered `useSearchParams()`, which throws
 * React #310 ("Rendered more hooks than during the previous render") and
 * flashes the Next.js application error. Canonicalize in middleware first.
 */
const RANGE_CANONICAL_PATHS = new Set([
  "/dashboard/overview",
  "/dashboard/visits",
  "/dashboard/releases",
  "/dashboard/search",
  "/dashboard/performance",
  "/dashboard/events",
  "/dashboard/sessions",
  "/dashboard/errors",
]);

function normalizeDashboardPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function dashboardRangeCanonicalHref(
  pathname: string,
  search: string
): string | null {
  const path = normalizeDashboardPath(pathname);
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const explicit = hasExplicitTimeRangeQuery({
    range: params.get("range") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });

  // `/dashboard` is only a redirect to Overview. Doing that in the page, after
  // the shell has rendered, throws React #310. Send the browser straight to
  // Overview before React starts, and keep an explicit range when one exists.
  if (path === "/dashboard") {
    if (!explicit) params.set("range", DEFAULT_DASHBOARD_TIME_RANGE);
    const q = params.toString();
    return q ? `/dashboard/overview?${q}` : "/dashboard/overview";
  }

  if (!RANGE_CANONICAL_PATHS.has(path)) return null;
  if (explicit) return null;
  params.set("range", DEFAULT_DASHBOARD_TIME_RANGE);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}
