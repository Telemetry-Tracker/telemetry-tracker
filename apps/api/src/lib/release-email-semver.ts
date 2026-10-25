/** Semver helpers for product update email automation (line-close policy). */

export type ReleaseSemver = {
  major: number;
  minor: number;
  patch: number;
};

export function parseReleaseVersion(input: string): ReleaseSemver | null {
  const trimmed = input.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareReleaseVersion(a: ReleaseSemver, b: ReleaseSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export type ReleaseEmailBumpDecision = {
  send: boolean;
  reason: string;
};

function formatReleaseVersion(version: ReleaseSemver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Display / ledger label for a minor line (e.g. `1.15` from `1.15.4`). */
export function formatMinorLineLabel(version: ReleaseSemver): string {
  return `${version.major}.${version.minor}`;
}

/**
 * Product milestone titles look like `v1.16.x — Release Intelligence`.
 * Returns the minor line when the title matches; ignores unrelated milestones.
 * Requires `.x` at the end of the version token (optional ` — title` / ` - title` suffix).
 */
export function parseProductMilestoneTitle(
  title: string
): { major: number; minor: number; lineLabel: string } | null {
  const trimmed = title.trim();
  // Em dash, en dash, or hyphen after optional whitespace — not arbitrary suffixes like "xtra".
  const match = /^v?(\d+)\.(\d+)\.x(?:\s*[—–-].*)?$/i.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return { major, minor, lineLabel: `${major}.${minor}` };
}

export type LineCloseVersionResolution =
  | { ok: true; version: string; previousVersion: string | null; lineLabel: string }
  | { ok: false; error: string };

/**
 * Given all known semver tags and a closed product minor line, pick:
 * - `version` = latest tag on that minor (`X.Y.*`)
 * - `previousVersion` = latest tag strictly before that minor line (previous minor final)
 */
export function resolveLineCloseVersions(
  tags: readonly string[],
  major: number,
  minor: number
): LineCloseVersionResolution {
  const lineLabel = `${major}.${minor}`;
  const parsed = tags
    .map((tag) => parseReleaseVersion(tag))
    .filter((v): v is ReleaseSemver => v !== null)
    .sort(compareReleaseVersion);

  const onLine = parsed.filter((v) => v.major === major && v.minor === minor);
  if (onLine.length === 0) {
    return {
      ok: false,
      error: `no semver tags found for minor line ${lineLabel} (expected v${lineLabel}.*)`,
    };
  }

  const closing = onLine[onLine.length - 1]!;
  const beforeLine = parsed.filter(
    (v) => v.major < major || (v.major === major && v.minor < minor)
  );
  const previous = beforeLine.length > 0 ? beforeLine[beforeLine.length - 1]! : null;

  return {
    ok: true,
    version: formatReleaseVersion(closing),
    previousVersion: previous ? formatReleaseVersion(previous) : null,
    lineLabel,
  };
}

export type ShouldSendReleaseEmailOptions = {
  /** Closing the last intended release of a minor line — send even for Z-only tags. */
  lineClose?: boolean;
};

/**
 * Product update emails send on **line close**, not when opening a new minor/major.
 *
 * - `lineClose: true` → send (operator closing `vX.Y.*` before the next milestone)
 * - Opening a new line (`X` or `Y` increase, typically `*.*.0`) → skip
 * - Mid-line patch (Z-only) → skip
 * - No previous tag → send only with `lineClose` (bootstrap / first broadcast)
 */
export function shouldSendProductUpdateEmail(
  current: string,
  previous?: string | null,
  options: ShouldSendReleaseEmailOptions = {}
): ReleaseEmailBumpDecision {
  const cur = parseReleaseVersion(current);
  if (!cur) {
    return { send: false, reason: `invalid current version: ${current}` };
  }

  const lineLabel = formatMinorLineLabel(cur);
  const to = formatReleaseVersion(cur);

  if (options.lineClose) {
    const prevRaw = previous?.trim();
    if (!prevRaw) {
      return {
        send: true,
        reason: `line close of ${lineLabel} (${to}; no previous semver tag)`,
      };
    }

    const prev = parseReleaseVersion(prevRaw);
    if (!prev) {
      return { send: false, reason: `invalid previous tag (${prevRaw})` };
    }

    const from = formatReleaseVersion(prev);
    const cmp = compareReleaseVersion(cur, prev);
    if (cmp < 0) {
      return { send: false, reason: `not a forward semver release (${from} → ${to})` };
    }
    if (cmp === 0) {
      return {
        send: true,
        reason: `line close of ${lineLabel} (same tag ${to}; re-run / backfill)`,
      };
    }
    if (prev.major === cur.major && prev.minor === cur.minor) {
      return {
        send: false,
        reason: `previous_version ${from} is on the same minor line as ${to} — set previous_version to the previous minor final (or last emailed release outside ${lineLabel}) so the email covers the whole ${lineLabel}.* line`,
      };
    }
    return {
      send: true,
      reason: `line close of ${lineLabel} (${from} → ${to})`,
    };
  }

  const prevRaw = previous?.trim();
  if (!prevRaw) {
    return {
      send: false,
      reason:
        "no previous semver tag — use line_close / --line-close for the first product update email",
    };
  }

  const prev = parseReleaseVersion(prevRaw);
  if (!prev) {
    return { send: false, reason: `invalid previous tag (${prevRaw})` };
  }

  const from = formatReleaseVersion(prev);
  const cmp = compareReleaseVersion(cur, prev);
  if (cmp <= 0) {
    return { send: false, reason: `not a forward semver release (${from} → ${to})` };
  }

  if (cur.major !== prev.major || cur.minor !== prev.minor) {
    return {
      send: false,
      reason: `crossed minor/major (${from} → ${to}) — tag push skips; use line_close on the final release of the completed line`,
    };
  }

  return {
    send: false,
    reason: `patch-only release (${from} → ${to}) — mid-line patches skip; use line_close on the final release of ${lineLabel}`,
  };
}

/**
 * Minor line that a new `vX.Y.0` / `vX.0.0` tag completes: the latest semver line
 * strictly before the opening tag. Returns null for patch tags (Z > 0) or when no
 * earlier line exists. Opening a new line is the signal that the previous line is done,
 * so tag pushes can auto-send the line-close email without a manual milestone close.
 */
export function previousLineClosedByOpeningTag(
  tags: readonly string[],
  openingTag: string
): { major: number; minor: number; lineLabel: string } | null {
  const opening = parseReleaseVersion(openingTag);
  if (!opening || opening.patch !== 0) return null;
  const before = tags
    .map((tag) => parseReleaseVersion(tag))
    .filter((v): v is ReleaseSemver => v !== null)
    .filter((v) => v.major < opening.major || (v.major === opening.major && v.minor < opening.minor))
    .sort(compareReleaseVersion);
  const last = before[before.length - 1];
  if (!last) return null;
  return { major: last.major, minor: last.minor, lineLabel: `${last.major}.${last.minor}` };
}

/**
 * True when at least two newer minor lines already have tags — i.e. the line is
 * historical. Closing an old milestone must not email subscribers about stale releases.
 * The most recently completed line (exactly one newer line exists) is still allowed.
 */
export function isStaleProductLine(
  tags: readonly string[],
  major: number,
  minor: number
): boolean {
  const newerLines = new Set<string>();
  for (const tag of tags) {
    const v = parseReleaseVersion(tag);
    if (!v) continue;
    if (v.major > major || (v.major === major && v.minor > minor)) {
      newerLines.add(`${v.major}.${v.minor}`);
    }
  }
  return newerLines.size >= 2;
}
