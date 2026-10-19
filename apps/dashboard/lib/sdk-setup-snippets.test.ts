import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOSTED_API_URL } from "./hosted-cloud";
import {
  buildNextEnvLocal,
  nextDocsCheckButton,
  nextDocsCheckPage,
  nextEnvLocal,
  nextEnvLocalServer,
  nextInstall,
  nextInstrumentation,
  nextProviderSetup,
  nextTestError,
  nextTrackPageView,
  nodeSetup,
  reactNativeSetup,
  reactSetup,
} from "./sdk-setup-snippets";

const appDir = join(import.meta.dirname, "..", "app");

describe("sdk setup snippets", () => {
  it("uses the hosted ingest URL and published package names", () => {
    expect(nextInstall).toContain("@telemetry-tracker/next");
    expect(nextProviderSetup).toContain(HOSTED_API_URL);
    expect(nextProviderSetup).toContain("TelemetryProvider");
    expect(nextProviderSetup).toContain("apiKey");
    expect(nextProviderSetup).toContain("NEXT_PUBLIC_TELEMETRY_API_KEY");
    expect(nextProviderSetup).toContain("React.ReactNode");
    expect(nextProviderSetup).toContain('from "./track-page-view"');
    expect(nextProviderSetup).not.toMatch(/\/\* get pathname/);

    expect(nextTrackPageView).toContain('"use client"');
    expect(nextTrackPageView).toContain("usePathname");
    expect(nextTrackPageView).toContain("useTrackPage");

    expect(nextEnvLocal).toContain(HOSTED_API_URL);
    expect(nextEnvLocal).toContain("NEXT_PUBLIC_TELEMETRY_API_KEY");
    expect(nextEnvLocal).toContain("NEXT_PUBLIC_TELEMETRY_INGEST_URL");
    expect(nextEnvLocal.split("\n").some((l) => /^TELEMETRY_API_KEY=/.test(l))).toBe(
      false
    );
    expect(nextEnvLocalServer).toContain("TELEMETRY_API_KEY");
    expect(nextEnvLocalServer).toContain("TELEMETRY_INGEST_URL");
    expect(nextEnvLocalServer).not.toContain("NEXT_PUBLIC_");

    expect(nextDocsCheckButton).toContain('"use client"');
    expect(nextDocsCheckButton).toContain('new Error("docs-check")');
    expect(nextDocsCheckButton).toMatch(/optional/i);
    expect(nextDocsCheckPage).toContain("DocsCheckButton");
    expect(nextDocsCheckPage).toMatch(/optional|temporary/i);
    expect(nextDocsCheckPage).not.toMatch(/^\/\/ app\/page\.tsx/m);
    expect(nextTestError).toContain("docs-check");

    expect(nextInstrumentation).toContain('@telemetry-tracker/next/server');
    expect(nextInstrumentation).toContain("createOnRequestError");
    expect(nextInstrumentation).toContain(HOSTED_API_URL);
    expect(nextInstrumentation).toContain("TELEMETRY_API_KEY");

    expect(reactSetup).toContain("@telemetry-tracker/core");
    expect(reactSetup).toContain(HOSTED_API_URL);

    expect(nodeSetup).toContain("@telemetry-tracker/node");
    expect(nodeSetup).toContain(HOSTED_API_URL);

    expect(reactNativeSetup).toContain("@telemetry-tracker/react-native");
    expect(reactNativeSetup).toContain("Platform.OS");
    expect(reactNativeSetup).toContain(HOSTED_API_URL);
  });

  it("keeps /docs/nextjs on the shared canonical snippets", () => {
    const src = readFileSync(join(appDir, "docs/nextjs/page.tsx"), "utf8");
    expect(src).toMatch(/from "@\/lib\/sdk-setup-snippets"/);
    expect(src).toContain("nextProviderSetup");
    expect(src).toContain("nextTrackPageView");
    expect(src).toContain("nextEnvLocal");
    expect(src).toContain("nextEnvLocalServer");
    expect(src).toContain("nextDocsCheckButton");
    expect(src).toContain("nextInstrumentation");
    expect(src).toMatch(/Verify your first error/);
    expect(src).toMatch(/Server-side error tracking with Next\.js App Router/);
    expect(src).not.toMatch(/1\.3\.1 is still browser-only|not on npm until/i);
    expect(src).not.toMatch(/\/\* get pathname from usePathname/);
  });

  it("keeps /error-tracking/nextjs aligned with the same snippets", () => {
    const src = readFileSync(join(appDir, "error-tracking/nextjs/page.tsx"), "utf8");
    expect(src).toMatch(/from "@\/lib\/sdk-setup-snippets"/);
    expect(src).toContain("nextProviderSetup");
    expect(src).toContain("nextTrackPageView");
    expect(src).toContain("nextEnvLocal");
    expect(src).toContain("nextEnvLocalServer");
    expect(src).toContain("nextInstrumentation");
    expect(src).toContain("nextDocsCheckButton");
    expect(src).toMatch(/Verify your first error/);
    expect(src).toMatch(/Server-side error tracking with Next\.js App Router/);
    expect(src).toContain('href: "/docs/migrate-from-sentry"');
    expect(src).toContain('href: "/docs/source-maps"');
    expect(src).toContain("createOnRequestError");
  });

  it("buildNextEnvLocal embeds the provided API key and hosted ingest URL", () => {
    const out = buildNextEnvLocal("tt_live_abc_secret", "demo-app");
    expect(out).toContain(`NEXT_PUBLIC_TELEMETRY_INGEST_URL=${HOSTED_API_URL}`);
    expect(out).toContain("NEXT_PUBLIC_TELEMETRY_API_KEY=tt_live_abc_secret");
    expect(out).toContain("NEXT_PUBLIC_TELEMETRY_APP=demo-app");
  });
});
