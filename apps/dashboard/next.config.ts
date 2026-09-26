import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
