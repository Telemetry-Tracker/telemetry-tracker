import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract body text for a semver or [Unreleased] section from CHANGELOG markdown. */
export function extractChangelogSectionFromContent(
  content: string,
  version: string
): string | null {
  const headerRe =
    version === "Unreleased"
      ? /^## \[Unreleased\][^\n]*\n/m
      : new RegExp(`^## \\[${escapeRegex(version)}\\][^\\n]*\\n`, "m");
  const match = content.match(headerRe);
  if (!match || match.index === undefined) return null;

  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeader = rest.search(/\n## \[/);
  const section = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
  if (!section || section === "---") return null;
  return section;
}

/** Resolve repo-root CHANGELOG.md from this module (stable regardless of process cwd). */
export function resolveChangelogPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../CHANGELOG.md");
}

export function loadChangelogSection(version: string): string | null {
  const content = readFileSync(resolveChangelogPath(), "utf8");
  return extractChangelogSectionFromContent(content, version);
}
