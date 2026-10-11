import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { latestChangelogVersion } from "./sentry-release";
import { getBuildPlatformVersion } from "./platform-version";

afterEach(() => vi.unstubAllEnvs());

it("exposes the CHANGELOG version injected at build time", () => {
  const changelog = readFileSync(resolve(__dirname, "../../../CHANGELOG.md"), "utf8");
  const version = latestChangelogVersion(changelog);
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  vi.stubEnv("TT_PLATFORM_VERSION", version!);
  expect(getBuildPlatformVersion()).toBe(version);
});

it("omits the version when the build cannot resolve it", () => {
  vi.stubEnv("TT_PLATFORM_VERSION", "");
  expect(getBuildPlatformVersion()).toBeUndefined();
});
