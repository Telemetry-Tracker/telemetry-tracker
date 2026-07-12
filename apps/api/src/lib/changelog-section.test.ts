import { describe, expect, it } from "vitest";
import { extractChangelogSectionFromContent } from "./changelog-section.js";

const SAMPLE = `# Changelog

## [Unreleased]

---

## [1.8.0] - 2026-07-12

### Added

- **Profile settings** — save display name

### Changed

- **Settings hub** — real changelog

---

## [1.7.4] - 2026-07-12

### Added

- Monitoring
`;

describe("extractChangelogSectionFromContent", () => {
  it("extracts a dated semver section without the date line in body", () => {
    const section = extractChangelogSectionFromContent(SAMPLE, "1.8.0");
    expect(section).toContain("### Added");
    expect(section).toContain("Profile settings");
    expect(section).not.toMatch(/^-\s*2026-/);
  });

  it("returns null when section is missing", () => {
    expect(extractChangelogSectionFromContent(SAMPLE, "9.9.9")).toBeNull();
  });

  it("returns null for empty Unreleased section", () => {
    expect(extractChangelogSectionFromContent(SAMPLE, "Unreleased")).toBeNull();
  });
});
