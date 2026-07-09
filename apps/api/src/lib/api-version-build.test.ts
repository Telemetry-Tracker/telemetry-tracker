import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const GENERATOR = join(import.meta.dirname, "../../scripts/generate-api-version.cjs");

describe("generate-api-version.cjs", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads latest released semver from monorepo CHANGELOG", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-version-changelog-"));
    tempDirs.push(dir);

    writeFileSync(
      join(dir, "CHANGELOG.md"),
      `# Changelog\n\n## [Unreleased]\n\n## [2.0.1] - 2026-07-09\n\n### Added\n\n- test\n`,
      "utf8"
    );

    const apiDir = join(dir, "apps/api");
    const scriptsDir = join(apiDir, "scripts");
    const generatedDir = join(apiDir, "src/generated");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(join(scriptsDir, "generate-api-version.cjs"), readFileSync(GENERATOR, "utf8"), "utf8");

    execSync(`node "${join(scriptsDir, "generate-api-version.cjs")}"`, { cwd: apiDir });

    const out = readFileSync(join(generatedDir, "api-version.ts"), "utf8");
    expect(out).toContain('API_VERSION = "2.0.1"');
  });

  it("preserves committed semver when CHANGELOG and git are unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-version-fallback-"));
    tempDirs.push(dir);

    const apiDir = join(dir, "apps/api");
    const scriptsDir = join(apiDir, "scripts");
    const generatedDir = join(apiDir, "src/generated");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(join(scriptsDir, "generate-api-version.cjs"), readFileSync(GENERATOR, "utf8"), "utf8");
    writeFileSync(
      join(generatedDir, "api-version.ts"),
      '/** Generated at build time from committed api-version.ts. Do not edit manually. */\nexport const API_VERSION = "9.8.7";\n',
      "utf8"
    );

    execSync(`node "${join(scriptsDir, "generate-api-version.cjs")}"`, {
      cwd: apiDir,
      env: { ...process.env, GIT_DIR: "/dev/null" },
    });

    const out = readFileSync(join(generatedDir, "api-version.ts"), "utf8");
    expect(out).toContain('API_VERSION = "9.8.7"');
  });

  it("resolves current repo CHANGELOG to a semver", () => {
    execSync(`node "${GENERATOR}"`, { cwd: join(import.meta.dirname, "../..") });
    const out = readFileSync(join(import.meta.dirname, "../generated/api-version.ts"), "utf8");
    const match = out.match(/export const API_VERSION = "([^"]+)"/);
    expect(match?.[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
