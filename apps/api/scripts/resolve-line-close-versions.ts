import {
  isStaleProductLine,
  parseProductMilestoneTitle,
  resolveLineCloseVersions,
} from "../src/lib/release-email-semver.js";

function argValue(prefix: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length);
}

const MILESTONE_TITLE =
  argValue("--milestone-title=") ?? process.env.MILESTONE_TITLE?.trim() ?? undefined;
const MINOR_ARG = argValue("--minor=") ?? process.env.MINOR_LINE?.trim() ?? undefined;
const TAGS_ARG = argValue("--tags=") ?? process.env.RELEASE_TAGS ?? undefined;

function usage(): never {
  console.error(
    "Usage: resolve-line-close-versions.ts (--milestone-title=… | --minor=X.Y) --tags=v1.15.9,v1.16.0,…\n" +
      "Or set MILESTONE_TITLE / MINOR_LINE and RELEASE_TAGS env vars."
  );
  process.exit(1);
}

function parseMinor(input: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)$/.exec(input.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

const line =
  MILESTONE_TITLE !== undefined
    ? parseProductMilestoneTitle(MILESTONE_TITLE)
    : MINOR_ARG
      ? (() => {
          const parsed = parseMinor(MINOR_ARG);
          return parsed
            ? { ...parsed, lineLabel: `${parsed.major}.${parsed.minor}` }
            : null;
        })()
      : null;

if (!line) {
  if (MILESTONE_TITLE !== undefined) {
    console.log(
      JSON.stringify({
        skip: true,
        reason: `milestone title is not a product line (expected vX.Y.x — …): ${MILESTONE_TITLE}`,
      })
    );
    process.exit(0);
  }
  usage();
}

const tags = (TAGS_ARG ?? "")
  .split(/[\s,]+/)
  .map((t) => t.trim())
  .filter(Boolean);

if (MILESTONE_TITLE !== undefined && isStaleProductLine(tags, line.major, line.minor)) {
  console.log(
    JSON.stringify({
      skip: true,
      reason: `${line.lineLabel} is a historical line (two or more newer minor lines are tagged) — not emailing subscribers about stale releases`,
    })
  );
  process.exit(0);
}

const resolved = resolveLineCloseVersions(tags, line.major, line.minor);
if (!resolved.ok) {
  console.error(resolved.error);
  process.exit(1);
}

console.log(
  JSON.stringify({
    skip: false,
    version: resolved.version,
    previous_version: resolved.previousVersion,
    line_label: resolved.lineLabel,
    line_close: true,
  })
);
