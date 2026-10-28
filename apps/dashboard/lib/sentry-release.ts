/**
 * Sentry `release` for the dashboard (browser, server, edge).
 *
 * Derived at build time in `next.config.ts` from the newest versioned section of the
 * repo-root `CHANGELOG.md` (the same source as the API's `API_VERSION`) and inlined as
 * `process.env.TT_SENTRY_RELEASE`. No Railway variable is needed. Format:
 * `telemetry-tracker-dashboard@1.18.3`. When the version cannot be resolved the release
 * stays unset (Sentry still sends errors; release-health sessions need a release).
 */

export const DASHBOARD_SENTRY_RELEASE_PREFIX = "telemetry-tracker-dashboard";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Newest `## [x.y.z]` heading (skips `[Unreleased]`), or null. */
export function latestChangelogVersion(changelog: string): string | null {
  for (const match of changelog.matchAll(/^## \[([^\]]+)\]/gm)) {
    const version = match[1]?.trim() ?? "";
    if (version === "Unreleased") continue;
    if (SEMVER_RE.test(version)) return version;
  }
  return null;
}

export function dashboardSentryReleaseFromChangelog(changelog: string | null): string | undefined {
  if (!changelog) return undefined;
  const version = latestChangelogVersion(changelog);
  return version ? `${DASHBOARD_SENTRY_RELEASE_PREFIX}@${version}` : undefined;
}

/** Runtime accessor (value inlined by `next.config.ts` `env`). */
export function getDashboardSentryRelease(): string | undefined {
  const release = process.env.TT_SENTRY_RELEASE?.trim();
  return release || undefined;
}
