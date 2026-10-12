import {
  previousLineClosedByOpeningTag,
  resolveLineCloseVersions,
} from "../src/lib/release-email-semver.js";

/**
 * Tag-push auto-send: when `vX.Y.0` opens a new line, resolve the line-close
 * versions for the previous minor line. Prints JSON `{ skip, reason }` or
 * `{ skip: false, version, previous_version, line_label }`.
 * Env: OPENING_TAG (e.g. v1.23.0), RELEASE_TAGS (comma-separated tags reachable from the tag).
 */
const openingTag = process.env.OPENING_TAG?.trim() ?? "";
const tags = (process.env.RELEASE_TAGS ?? "")
  .split(/[\s,]+/)
  .map((t) => t.trim())
  .filter(Boolean);

const line = previousLineClosedByOpeningTag(tags, openingTag);
if (!line) {
  console.log(
    JSON.stringify({
      skip: true,
      reason: `${openingTag} does not open a new minor/major line after an earlier line — mid-line patches do not email`,
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
  })
);
