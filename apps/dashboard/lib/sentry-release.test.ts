import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dashboardSentryReleaseFromChangelog,
  getDashboardSentryRelease,
  latestChangelogVersion,
} from "./sentry-release";
import { sentryInitOptions } from "./sentry";

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

---

## [1.18.3] - 2026-10-06

### Fixed

- something

## [1.18.2] - 2026-10-06
`;

describe("dashboard Sentry release", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the newest versioned CHANGELOG section, skipping Unreleased", () => {
    expect(latestChangelogVersion(CHANGELOG)).toBe("1.18.3");
    expect(dashboardSentryReleaseFromChangelog(CHANGELOG)).toBe(
      "telemetry-tracker-dashboard@1.18.3"
    );
  });

  it("falls back to undefined when no version can be resolved", () => {
    expect(dashboardSentryReleaseFromChangelog(null)).toBeUndefined();
    expect(dashboardSentryReleaseFromChangelog("## [Unreleased]\n")).toBeUndefined();
    expect(dashboardSentryReleaseFromChangelog("## [not-a-version]\n")).toBeUndefined();
  });

  it("matches the real repo CHANGELOG format", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const real = readFileSync(join(__dirname, "..", "..", "..", "CHANGELOG.md"), "utf8");
    expect(dashboardSentryReleaseFromChangelog(real)).toMatch(
      /^telemetry-tracker-dashboard@\d+\.\d+\.\d+$/
    );
  });

  it("sets release on Sentry init options only when present", () => {
    vi.stubEnv("TT_SENTRY_RELEASE", "  telemetry-tracker-dashboard@1.18.3  ");
    expect(getDashboardSentryRelease()).toBe("telemetry-tracker-dashboard@1.18.3");
    expect(sentryInitOptions("https://public@o1.ingest.de.sentry.io/1").release).toBe(
      "telemetry-tracker-dashboard@1.18.3"
    );

    vi.stubEnv("TT_SENTRY_RELEASE", "");
    expect(getDashboardSentryRelease()).toBeUndefined();
    expect(sentryInitOptions("https://public@o1.ingest.de.sentry.io/1")).not.toHaveProperty(
      "release"
    );
  });
});
