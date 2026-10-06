import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import path from "path";
import { dashboardSentryReleaseFromChangelog } from "./lib/sentry-release";

function readRepoChangelog(): string | null {
  for (const candidate of [
    path.join(__dirname, "..", "..", "CHANGELOG.md"),
    path.join(process.cwd(), "..", "..", "CHANGELOG.md"),
    path.join(process.cwd(), "CHANGELOG.md"),
  ]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

// Sentry release (e.g. `telemetry-tracker-dashboard@1.18.3`) from CHANGELOG at build time.
// Inlined into client, server, and edge bundles; omitted (release unset) if unresolved.
const sentryRelease = dashboardSentryReleaseFromChangelog(readRepoChangelog());

const nextConfig: NextConfig = {
  env: sentryRelease ? { TT_SENTRY_RELEASE: sentryRelease } : {},
  // Put <title> and other metadata in <head> for crawlers instead of streaming them into <body>.
  htmlLimitedBots: /.*/,
  // Avoid duplicate server/API work in dev (Strict Mode renders Server Components twice).
  reactStrictMode: false,
  // Monorepo: trace from repo root so Next finds workspace deps (@telemetry-tracker/core, @telemetry-tracker/next)
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // Lint runs in `prebuild` via root `eslint.config.mjs` (Next’s built-in pass doesn’t detect FlatCompat + monorepo).
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withSentryConfig(nextConfig, {
  // Source map upload is optional — set SENTRY_AUTH_TOKEN in CI when ready.
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    automaticVercelMonitors: false,
  },
});
