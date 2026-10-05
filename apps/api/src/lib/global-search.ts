/**
 * Global Search (#494): cross-entity search scoped to the current project.
 *
 * Returns limited top matches per entity group. Exhaustive scan is out of scope.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { escapeLikePattern } from "./list-query.js";
import { errorGroupTermsMatchSql } from "./list-query-helpers.js";
import {
  isUnknownReleaseKey,
  normalizeReleaseKeySql,
  releaseDisplayLabel,
  releaseFilterMatchSql,
  releaseKeyFromDbValue,
  sessionEffectiveReleaseKeySql,
  UNKNOWN_RELEASE_KEY,
} from "./release-key.js";
import { sessionEnvReleaseMatchSql } from "./sessions-page-summary.js";
import {
  deviceFilterPatterns,
  hasGlobalSearchWork,
  type ParsedGlobalSearchQuery,
} from "./global-search-query.js";

/** Max hits returned per entity group (MVP). */
export const GLOBAL_SEARCH_LIMIT_PER_GROUP = 8;

export type GlobalSearchScope = {
  appId?: string;
  environment?: string;
  platform?: string;
  release?: string;
  browser?: string;
  country?: string;
  device?: string;
  error?: string;
  user?: string;
  range: { gte?: Date; lte?: Date };
  /**
   * Session/user `started_at` bounds — always set for Sessions-list parity
   * (`resolveSessionListStartedAtBounds` + `metricsUntil` anchor).
   */
  sessionStartedAt?: { gte: Date; lte: Date };
  /**
   * Event `created_at` bounds — Sessions/Events list parity for open-ended ranges
   * (`enrichEventListFilterForMetrics` / ~7d when range is all-time).
   */
  eventCreatedAt?: { gte?: Date; lte?: Date };
  /**
   * Issues time window from the search route (`occurrenceCountRange` for
   * open-ended ranges). Used for occurrence EXISTS when release/platform is
   * set, and for `ErrorGroup.last_seen` on time-only issue hits.
   */
  errorOccurrenceRange?: { gte?: Date; lte?: Date };
};

export type GlobalSearchErrorHit = {
  id: string;
  title: string;
  subtitle: string | null;
  app: string;
  environment: string | null;
  release: string | null;
  platform: string | null;
  lastSeenAt: string;
};

export type GlobalSearchEventHit = {
  name: string;
  title: string;
  eventCount: number;
  lastSeenAt: string;
};

export type GlobalSearchSessionHit = {
  id: string;
  sessionId: string;
  title: string;
  subtitle: string | null;
  userId: string | null;
  anonymousId: string | null;
  country: string | null;
  browser: string | null;
  platform: string | null;
  release: string | null;
  startedAt: string;
};

export type GlobalSearchReleaseHit = {
  releaseKey: string;
  title: string;
};

export type GlobalSearchUserHit = {
  identity: string;
  identityKind: "user" | "anonymous";
  title: string;
  subtitle: string | null;
};

export type GlobalSearchGroup<T> = {
  items: T[];
  /** True when more matches may exist beyond the per-group limit. */
  truncated: boolean;
};

export type GlobalSearchResult = {
  q: string;
  parsed: {
    freeText: string;
    freeTextTerms: string[];
    filters: ParsedGlobalSearchQuery["filters"];
    ignoredKeys: string[];
  };
  limitPerGroup: number;
  emptyQuery: boolean;
  groups: {
    errors: GlobalSearchGroup<GlobalSearchErrorHit>;
    events: GlobalSearchGroup<GlobalSearchEventHit>;
    sessions: GlobalSearchGroup<GlobalSearchSessionHit>;
    releases: GlobalSearchGroup<GlobalSearchReleaseHit>;
    users: GlobalSearchGroup<GlobalSearchUserHit>;
  };
};

function emptyGroup<T>(): GlobalSearchGroup<T> {
  return { items: [], truncated: false };
}

function likePat(term: string): string {
  return `%${escapeLikePattern(term.trim())}%`;
}

/** AND of ILIKE predicates for each free-text term against one or more columns. */
function freeTextAndSql(
  terms: string[],
  columnExprs: Prisma.Sql[]
): Prisma.Sql | null {
  if (terms.length === 0) return null;
  const termClauses = terms.map((term) => {
    const pat = likePat(term);
    const ors = columnExprs.map(
      (col) => Prisma.sql`COALESCE(${col}, '') ILIKE ${pat} ESCAPE '\\'`
    );
    return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
  });
  return Prisma.join(termClauses, " AND ");
}

function deviceMatchSql(
  device: string,
  columns: Prisma.Sql[]
): Prisma.Sql {
  const normalized = device.trim().toLowerCase();
  const escapedPatterns =
    normalized === "mobile" || normalized === "desktop"
      ? deviceFilterPatterns(device)
      : [`%${escapeLikePattern(device.trim())}%`];

  const ors: Prisma.Sql[] = [];
  for (const pat of escapedPatterns) {
    for (const col of columns) {
      ors.push(Prisma.sql`COALESCE(${col}, '') ILIKE ${pat} ESCAPE '\\'`);
    }
  }
  return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
}

type SearchTableAlias = "eg" | "e" | "s";

/**
 * Session/user env+release filter — same effective-release / NULL-env rules as
 * the Sessions list (`sessionEnvReleaseMatchSql`).
 */
export function globalSearchSessionEnvReleaseSql(
  projectId: string,
  scope: Pick<
    GlobalSearchScope,
    "release" | "environment" | "platform" | "sessionStartedAt"
  >
): Prisma.Sql | null {
  return sessionEnvReleaseMatchSql(
    projectId,
    "s",
    {
      environment: scope.environment,
      release: scope.release,
      platform: scope.platform,
    },
    scope.sessionStartedAt
      ? { gte: scope.sessionStartedAt.gte, lte: scope.sessionStartedAt.lte }
      : undefined
  );
}

/** @deprecated Prefer {@link globalSearchSessionEnvReleaseSql}; kept for release-only tests. */
export function globalSearchSessionReleaseSql(
  projectId: string,
  scope: Pick<GlobalSearchScope, "release" | "environment" | "platform">
): Prisma.Sql | null {
  if (!scope.release) return null;
  return globalSearchSessionEnvReleaseSql(projectId, scope);
}

export type GlobalSearchReleaseActivitySource = "event" | "session" | "error";

/**
 * Time bounds for release-search activity, aligned with the matching entity group
 * (`eventCreatedAt` / `sessionStartedAt` / `errorOccurrenceRange`, else `range`).
 * Missing sides fall back to `sessionStartedAt` (always closed from the search route)
 * so open-ended `from:` / `range.gte` still share the metricsUntil upper bound.
 * Empty when no window is set — callers skip the predicate (all-time).
 */
export function globalSearchReleaseActivityBounds(
  source: GlobalSearchReleaseActivitySource,
  scope: Pick<
    GlobalSearchScope,
    "range" | "eventCreatedAt" | "sessionStartedAt" | "errorOccurrenceRange"
  >
): { gte?: Date; lte?: Date } {
  const closedFallback = scope.sessionStartedAt
    ? {
        gte: scope.sessionStartedAt.gte,
        lte: scope.sessionStartedAt.lte,
      }
    : { gte: scope.range.gte, lte: scope.range.lte };

  if (source === "event") {
    return {
      gte: scope.eventCreatedAt?.gte ?? closedFallback.gte,
      lte: scope.eventCreatedAt?.lte ?? closedFallback.lte,
    };
  }
  if (source === "session") {
    return {
      gte: scope.sessionStartedAt?.gte ?? scope.range.gte,
      lte: scope.sessionStartedAt?.lte ?? scope.range.lte,
    };
  }
  return {
    gte: scope.errorOccurrenceRange?.gte ?? closedFallback.gte,
    lte: scope.errorOccurrenceRange?.lte ?? closedFallback.lte,
  };
}

/**
 * SQL predicate for release activity in the search window.
 * Events → `created_at`; sessions → `started_at`; errors → occurrence `created_at`
 * (Release Health KPI activity). Returns null when no bounds are set.
 */
export function globalSearchReleaseActivityTimeSql(
  source: GlobalSearchReleaseActivitySource,
  scope: Pick<
    GlobalSearchScope,
    "range" | "eventCreatedAt" | "sessionStartedAt" | "errorOccurrenceRange"
  >
): Prisma.Sql | null {
  const bounds = globalSearchReleaseActivityBounds(source, scope);
  if (!bounds.gte && !bounds.lte) return null;
  const col =
    source === "event"
      ? Prisma.sql`e."created_at"`
      : source === "session"
        ? Prisma.sql`s."started_at"`
        : Prisma.sql`eo."created_at"`;
  const parts: Prisma.Sql[] = [];
  if (bounds.gte) parts.push(Prisma.sql`${col} >= ${bounds.gte}`);
  if (bounds.lte) parts.push(Prisma.sql`${col} <= ${bounds.lte}`);
  return Prisma.join(parts, " AND ");
}

function baseScopeParts(
  projectId: string,
  scope: GlobalSearchScope,
  tableAlias: SearchTableAlias,
  opts: {
    timeColumn: "last_seen" | "created_at" | "started_at";
    includeRelease?: boolean;
  }
): Prisma.Sql[] {
  const projectCol =
    tableAlias === "eg"
      ? Prisma.sql`eg."project_id"`
      : tableAlias === "e"
        ? Prisma.sql`e."project_id"`
        : Prisma.sql`s."project_id"`;
  const appCol =
    tableAlias === "eg"
      ? Prisma.sql`eg."app"`
      : tableAlias === "e"
        ? Prisma.sql`e."app"`
        : Prisma.sql`s."app"`;
  const envCol =
    tableAlias === "eg"
      ? Prisma.sql`eg."environment"`
      : tableAlias === "e"
        ? Prisma.sql`e."environment"`
        : Prisma.sql`s."environment"`;
  const platformCol =
    tableAlias === "eg"
      ? Prisma.sql`eg."platform"`
      : tableAlias === "e"
        ? Prisma.sql`e."platform"`
        : Prisma.sql`s."platform"`;
  const releaseCol =
    tableAlias === "eg"
      ? Prisma.sql`eg."release"`
      : tableAlias === "e"
        ? Prisma.sql`e."release"`
        : Prisma.sql`s."release"`;
  const timeCol =
    opts.timeColumn === "last_seen"
      ? Prisma.sql`eg."last_seen"`
      : opts.timeColumn === "started_at"
        ? Prisma.sql`s."started_at"`
        : tableAlias === "e"
          ? Prisma.sql`e."created_at"`
          : Prisma.sql`eg."created_at"`;

  const parts: Prisma.Sql[] = [Prisma.sql`${projectCol} = ${projectId}`];
  if (scope.appId) parts.push(Prisma.sql`${appCol} = ${scope.appId}`);

  if (tableAlias === "s") {
    // Sessions list parity: effective release + NULL-env event fallback.
    const envRelease = globalSearchSessionEnvReleaseSql(projectId, {
      environment: scope.environment,
      release: opts.includeRelease === false ? undefined : scope.release,
      platform: scope.platform,
      sessionStartedAt: scope.sessionStartedAt,
    });
    if (envRelease) parts.push(envRelease);
  } else {
    if (scope.environment) {
      parts.push(Prisma.sql`${envCol} = ${scope.environment}`);
    }
    if (scope.release && opts.includeRelease !== false) {
      parts.push(releaseFilterMatchSql(releaseCol, scope.release));
    }
  }

  if (scope.platform) {
    parts.push(Prisma.sql`${platformCol} = ${scope.platform}`);
  }
  if (opts.timeColumn === "started_at" && scope.sessionStartedAt) {
    parts.push(Prisma.sql`${timeCol} >= ${scope.sessionStartedAt.gte}`);
    parts.push(Prisma.sql`${timeCol} <= ${scope.sessionStartedAt.lte}`);
  } else if (opts.timeColumn === "created_at" && scope.eventCreatedAt) {
    if (scope.eventCreatedAt.gte) {
      parts.push(Prisma.sql`${timeCol} >= ${scope.eventCreatedAt.gte}`);
    }
    if (scope.eventCreatedAt.lte) {
      parts.push(Prisma.sql`${timeCol} <= ${scope.eventCreatedAt.lte}`);
    }
  } else {
    if (scope.range.gte) {
      parts.push(Prisma.sql`${timeCol} >= ${scope.range.gte}`);
    }
    if (scope.range.lte) {
      parts.push(Prisma.sql`${timeCol} <= ${scope.range.lte}`);
    }
  }
  return parts;
}

function isSessionOnlyFilterSearch(
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope
): boolean {
  if (parsed.freeTextTerms.length > 0 || scope.error || scope.release) return false;
  return Boolean(scope.browser || scope.country || scope.device || scope.user);
}

/**
 * True when the scope carries a time window — parsed `range`/`from`/`to`, or the
 * route-built metrics windows (`sessionStartedAt` / `eventCreatedAt` /
 * `errorOccurrenceRange`) used for Sessions/Events list parity when the range
 * is open-ended or all-time (`range:all`, invalid `range:none`, etc.).
 */
export function hasGlobalSearchTimeSignal(
  scope: Pick<
    GlobalSearchScope,
    "range" | "sessionStartedAt" | "eventCreatedAt" | "errorOccurrenceRange"
  >
): boolean {
  return Boolean(
    scope.range.gte ||
      scope.range.lte ||
      scope.sessionStartedAt ||
      scope.eventCreatedAt?.gte ||
      scope.eventCreatedAt?.lte ||
      scope.errorOccurrenceRange?.gte ||
      scope.errorOccurrenceRange?.lte
  );
}

async function searchErrors(
  prisma: PrismaClient,
  projectId: string,
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope,
  limit: number
): Promise<GlobalSearchGroup<GlobalSearchErrorHit>> {
  if (isSessionOnlyFilterSearch(parsed, scope)) {
    return emptyGroup();
  }

  // Align with Issues list: release/platform/time scope via ErrorOccurrence EXISTS.
  const parts: Prisma.Sql[] = [Prisma.sql`eg."project_id" = ${projectId}`];
  if (scope.appId) parts.push(Prisma.sql`eg."app" = ${scope.appId}`);
  if (scope.environment) {
    parts.push(Prisma.sql`eg."environment" = ${scope.environment}`);
  }

  const textTerms = [...parsed.freeTextTerms];
  if (scope.error) textTerms.push(scope.error);

  const textSql = errorGroupTermsMatchSql(
    textTerms,
    Prisma.sql`eg."message"`,
    Prisma.sql`eg."fingerprint"`,
    Prisma.sql`eg."id"`
  );
  if (textSql) parts.push(textSql);

  // Issues list: release/platform → occurrence EXISTS; time-only → ErrorGroup.last_seen.
  const hasOccurrenceScope = Boolean(scope.release || scope.platform);
  if (hasOccurrenceScope) {
    const scopeParts: Prisma.Sql[] = [];
    if (scope.release) {
      scopeParts.push(releaseFilterMatchSql(Prisma.sql`rel."release"`, scope.release));
    }
    if (scope.platform) {
      scopeParts.push(Prisma.sql`rel."platform" = ${scope.platform}`);
    }
    const bounds = scope.errorOccurrenceRange ?? scope.range;
    if (bounds.gte) {
      scopeParts.push(Prisma.sql`rel."created_at" >= ${bounds.gte}`);
    }
    if (bounds.lte) {
      scopeParts.push(Prisma.sql`rel."created_at" <= ${bounds.lte}`);
    }
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ErrorOccurrence" rel
      WHERE rel."error_group_id" = eg."id"
        AND ${Prisma.join(scopeParts, " AND ")}
    )`);
  } else {
    // Time-only: last_seen with the same effective window as Issues metrics
    // (errorOccurrenceRange when range is open-ended / all-time).
    const bounds = scope.errorOccurrenceRange ?? scope.range;
    if (bounds.gte) {
      parts.push(Prisma.sql`eg."last_seen" >= ${bounds.gte}`);
    }
    if (bounds.lte) {
      parts.push(Prisma.sql`eg."last_seen" <= ${bounds.lte}`);
    }
  }

  // Require some match signal beyond broad list dumps of the whole project.
  // Time-only queries (`range:` / from/to / metrics windows) are a valid signal.
  if (
    textTerms.length === 0 &&
    !scope.environment &&
    !scope.platform &&
    !scope.release &&
    !scope.appId &&
    !hasGlobalSearchTimeSignal(scope)
  ) {
    return emptyGroup();
  }

  const fetchLimit = limit + 1;
  type Row = {
    id: string;
    message: string;
    fingerprint: string;
    app: string;
    environment: string | null;
    release: string | null;
    platform: string | null;
    last_seen: Date;
  };

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      eg."id",
      eg."message",
      eg."fingerprint",
      eg."app",
      eg."environment",
      eg."release",
      eg."platform",
      eg."last_seen"
    FROM "ErrorGroup" eg
    WHERE ${Prisma.join(parts, " AND ")}
    ORDER BY eg."last_seen" DESC
    LIMIT ${fetchLimit}
  `);

  const truncated = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.message,
    subtitle: r.fingerprint || null,
    app: r.app,
    environment: r.environment,
    release: r.release,
    platform: r.platform,
    lastSeenAt: r.last_seen.toISOString(),
  }));
  return { items, truncated };
}

async function searchEvents(
  prisma: PrismaClient,
  projectId: string,
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope,
  limit: number
): Promise<GlobalSearchGroup<GlobalSearchEventHit>> {
  if (isSessionOnlyFilterSearch(parsed, scope)) {
    return emptyGroup();
  }
  // When error-only filters are set without free text, skip events.
  if (scope.error && parsed.freeTextTerms.length === 0) {
    return emptyGroup();
  }

  const parts = baseScopeParts(projectId, scope, "e", { timeColumn: "created_at" });

  const textSql = freeTextAndSql(parsed.freeTextTerms, [
    Prisma.sql`e."name"`,
    Prisma.sql`e."properties"::text`,
  ]);
  if (textSql) parts.push(textSql);

  if (
    parsed.freeTextTerms.length === 0 &&
    !scope.environment &&
    !scope.platform &&
    !scope.release &&
    !scope.appId &&
    !hasGlobalSearchTimeSignal(scope)
  ) {
    return emptyGroup();
  }

  const fetchLimit = limit + 1;
  type Row = { name: string; event_count: bigint; last_seen: Date };

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      e."name" AS name,
      COUNT(*)::bigint AS event_count,
      MAX(e."created_at") AS last_seen
    FROM "Event" e
    WHERE ${Prisma.join(parts, " AND ")}
    GROUP BY e."name"
    ORDER BY last_seen DESC
    LIMIT ${fetchLimit}
  `);

  const truncated = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({
    name: r.name,
    title: r.name,
    eventCount: Number(r.event_count),
    lastSeenAt: r.last_seen.toISOString(),
  }));
  return { items, truncated };
}

async function searchSessions(
  prisma: PrismaClient,
  projectId: string,
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope,
  limit: number
): Promise<GlobalSearchGroup<GlobalSearchSessionHit>> {
  const parts = baseScopeParts(projectId, scope, "s", { timeColumn: "started_at" });

  if (scope.country) {
    parts.push(Prisma.sql`s."country" = ${scope.country}`);
  }
  if (scope.browser) {
    const pat = likePat(scope.browser);
    parts.push(
      Prisma.sql`COALESCE(s."device_browser", '') ILIKE ${pat} ESCAPE '\\'`
    );
  }
  if (scope.device) {
    parts.push(
      deviceMatchSql(scope.device, [
        Prisma.sql`s."platform"`,
        Prisma.sql`s."device_os"`,
        Prisma.sql`s."device_browser"`,
      ])
    );
  }
  if (scope.user) {
    const pat = likePat(scope.user);
    parts.push(Prisma.sql`(
      COALESCE(s."user_id", '') ILIKE ${pat} ESCAPE '\\'
      OR COALESCE(s."anonymous_id", '') ILIKE ${pat} ESCAPE '\\'
      OR COALESCE(s."user_email", '') ILIKE ${pat} ESCAPE '\\'
    )`);
  }

  const textSql = freeTextAndSql(parsed.freeTextTerms, [
    Prisma.sql`s."session_id"`,
    Prisma.sql`s."user_id"`,
    Prisma.sql`s."anonymous_id"`,
    Prisma.sql`s."user_email"`,
    Prisma.sql`s."country"`,
    Prisma.sql`s."device_browser"`,
    Prisma.sql`s."device_os"`,
    Prisma.sql`s."release"`,
    Prisma.sql`s."platform"`,
  ]);
  if (textSql) parts.push(textSql);

  if (scope.error && parsed.freeTextTerms.length === 0 && !scope.user && !scope.browser && !scope.country && !scope.device) {
    return emptyGroup();
  }

  const fetchLimit = limit + 1;
  type Row = {
    id: string;
    session_id: string;
    user_id: string | null;
    anonymous_id: string | null;
    user_email: string | null;
    country: string | null;
    device_browser: string | null;
    platform: string | null;
    release: string | null;
    started_at: Date;
  };

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      s."id",
      s."session_id",
      s."user_id",
      s."anonymous_id",
      s."user_email",
      s."country",
      s."device_browser",
      s."platform",
      s."release",
      s."started_at"
    FROM "Session" s
    WHERE ${Prisma.join(parts, " AND ")}
    ORDER BY s."started_at" DESC
    LIMIT ${fetchLimit}
  `);

  const truncated = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => {
    const identity = r.user_id || r.user_email || r.anonymous_id;
    const subtitleParts = [
      identity,
      r.country,
      r.device_browser,
      r.release ? releaseDisplayLabel(releaseKeyFromDbValue(r.release)) : null,
    ].filter(Boolean);
    return {
      id: r.id,
      sessionId: r.session_id,
      title: `Session ${r.session_id}`,
      subtitle: subtitleParts.length ? subtitleParts.join(" · ") : null,
      userId: r.user_id,
      anonymousId: r.anonymous_id,
      country: r.country,
      browser: r.device_browser,
      platform: r.platform,
      release: r.release,
      startedAt: r.started_at.toISOString(),
    };
  });
  return { items, truncated };
}

async function searchReleases(
  prisma: PrismaClient,
  projectId: string,
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope,
  limit: number
): Promise<GlobalSearchGroup<GlobalSearchReleaseHit>> {
  // Releases search is by identifier; session-only filters don't apply alone.
  if (
    (scope.browser || scope.country || scope.device || scope.user || scope.error) &&
    parsed.freeTextTerms.length === 0 &&
    !scope.release
  ) {
    return emptyGroup();
  }

  const releaseKeyExpr = normalizeReleaseKeySql(Prisma.sql`src."release"`);

  const whereParts: Prisma.Sql[] = [Prisma.sql`src."project_id" = ${projectId}`];
  if (scope.appId) whereParts.push(Prisma.sql`src."app" = ${scope.appId}`);
  if (scope.environment) {
    whereParts.push(Prisma.sql`src."environment" = ${scope.environment}`);
  }
  if (scope.platform) {
    whereParts.push(Prisma.sql`src."platform" = ${scope.platform}`);
  }

  if (scope.release) {
    if (isUnknownReleaseKey(scope.release)) {
      whereParts.push(Prisma.sql`${releaseKeyExpr} IS NULL`);
    } else {
      whereParts.push(Prisma.sql`${releaseKeyExpr} = ${scope.release.trim()}`);
    }
  }
  if (parsed.freeTextTerms.length > 0) {
    const termClauses = parsed.freeTextTerms.map((term) => {
      const pat = likePat(term);
      const unknownHit =
        term.toLowerCase() === "unknown" || term === UNKNOWN_RELEASE_KEY
          ? Prisma.sql`${releaseKeyExpr} IS NULL`
          : Prisma.sql`FALSE`;
      return Prisma.sql`(
        (${releaseKeyExpr} IS NOT NULL AND ${releaseKeyExpr} ILIKE ${pat} ESCAPE '\\')
        OR ${unknownHit}
      )`;
    });
    whereParts.push(Prisma.join(termClauses, " AND "));
  } else if (
    !scope.release &&
    !scope.environment &&
    !scope.platform &&
    !scope.appId &&
    !hasGlobalSearchTimeSignal(scope)
  ) {
    // No free text / scope / time signal — avoid dumping all releases.
    // Time-only (`range:` / from/to / metrics windows) is valid, same as issues/events.
    return emptyGroup();
  }

  const fetchLimit = limit + 1;
  type Row = { release_key: string | null };

  // Activity in the same window as other search groups (Release Health KPI sources).
  const eventWhere: Prisma.Sql[] = [Prisma.sql`e."project_id" = ${projectId}`];
  const eventTime = globalSearchReleaseActivityTimeSql("event", scope);
  if (eventTime) eventWhere.push(eventTime);

  const sessionWhere: Prisma.Sql[] = [Prisma.sql`s."project_id" = ${projectId}`];
  const sessionTime = globalSearchReleaseActivityTimeSql("session", scope);
  if (sessionTime) sessionWhere.push(sessionTime);

  const errorWhere: Prisma.Sql[] = [Prisma.sql`eg."project_id" = ${projectId}`];
  const errorTime = globalSearchReleaseActivityTimeSql("error", scope);
  if (errorTime) errorWhere.push(errorTime);

  // Session branch: effective release (COALESCE session + latest known event), Release Health parity.
  const sessionReleaseExpr = sessionEffectiveReleaseKeySql(projectId, "s", {
    environment: scope.environment,
    platform: scope.platform,
  });

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT release_key FROM (
      SELECT DISTINCT ${releaseKeyExpr} AS release_key
      FROM (
        SELECT e."project_id", e."app", e."environment", e."platform", e."release"
        FROM "Event" e
        WHERE ${Prisma.join(eventWhere, " AND ")}
        UNION ALL
        SELECT s."project_id", s."app", s."environment", s."platform",
          (${sessionReleaseExpr}) AS "release"
        FROM "Session" s
        WHERE ${Prisma.join(sessionWhere, " AND ")}
        UNION ALL
        SELECT eg."project_id", eg."app", eg."environment", eo."platform", eo."release"
        FROM "ErrorOccurrence" eo
        INNER JOIN "ErrorGroup" eg ON eg."id" = eo."error_group_id"
        WHERE ${Prisma.join(errorWhere, " AND ")}
      ) src
      WHERE ${Prisma.join(whereParts, " AND ")}
    ) keys
    ORDER BY CASE WHEN release_key IS NULL THEN 1 ELSE 0 END, release_key ASC
    LIMIT ${fetchLimit}
  `);

  const truncated = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => {
    const key = r.release_key ?? UNKNOWN_RELEASE_KEY;
    return {
      releaseKey: key,
      title: releaseDisplayLabel(key),
    };
  });
  return { items, truncated };
}

async function searchUsers(
  prisma: PrismaClient,
  projectId: string,
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope,
  limit: number
): Promise<GlobalSearchGroup<GlobalSearchUserHit>> {
  if (scope.error && !scope.user && parsed.freeTextTerms.length === 0) {
    return emptyGroup();
  }

  const parts = baseScopeParts(projectId, scope, "s", {
    timeColumn: "started_at",
    includeRelease: true,
  });

  if (scope.country) parts.push(Prisma.sql`s."country" = ${scope.country}`);
  if (scope.browser) {
    const pat = likePat(scope.browser);
    parts.push(
      Prisma.sql`COALESCE(s."device_browser", '') ILIKE ${pat} ESCAPE '\\'`
    );
  }
  if (scope.device) {
    parts.push(
      deviceMatchSql(scope.device, [
        Prisma.sql`s."platform"`,
        Prisma.sql`s."device_os"`,
        Prisma.sql`s."device_browser"`,
      ])
    );
  }

  const identityTerms = [...parsed.freeTextTerms];
  if (scope.user) identityTerms.push(scope.user);

  if (identityTerms.length === 0) {
    return emptyGroup();
  }

  const textSql = freeTextAndSql(identityTerms, [
    Prisma.sql`s."user_id"`,
    Prisma.sql`s."anonymous_id"`,
    Prisma.sql`s."user_email"`,
  ]);
  if (textSql) parts.push(textSql);

  // Require at least one identity.
  parts.push(Prisma.sql`(
    (s."user_id" IS NOT NULL AND TRIM(s."user_id") <> '')
    OR (s."anonymous_id" IS NOT NULL AND TRIM(s."anonymous_id") <> '')
  )`);

  const fetchLimit = limit + 1;
  type Row = {
    identity: string;
    identity_kind: string;
    user_email: string | null;
  };

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT identity, identity_kind, user_email FROM (
      SELECT DISTINCT ON (identity)
        CASE
          WHEN s."user_id" IS NOT NULL AND TRIM(s."user_id") <> '' THEN TRIM(s."user_id")
          ELSE TRIM(s."anonymous_id")
        END AS identity,
        CASE
          WHEN s."user_id" IS NOT NULL AND TRIM(s."user_id") <> '' THEN 'user'
          ELSE 'anonymous'
        END AS identity_kind,
        s."user_email" AS user_email,
        s."started_at" AS started_at
      FROM "Session" s
      WHERE ${Prisma.join(parts, " AND ")}
      ORDER BY identity, s."started_at" DESC
    ) u
    ORDER BY started_at DESC
    LIMIT ${fetchLimit}
  `);

  const truncated = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => {
    const kind = r.identity_kind === "user" ? ("user" as const) : ("anonymous" as const);
    return {
      identity: r.identity,
      identityKind: kind,
      title: r.identity,
      subtitle:
        kind === "user"
          ? r.user_email
            ? `Identified · ${r.user_email}`
            : "Identified user"
          : "Anonymous",
    };
  });
  return { items, truncated };
}

export async function executeGlobalSearch(
  prisma: PrismaClient,
  projectId: string,
  parsed: ParsedGlobalSearchQuery,
  scope: GlobalSearchScope,
  limitPerGroup: number = GLOBAL_SEARCH_LIMIT_PER_GROUP
): Promise<GlobalSearchResult> {
  const emptyQuery = !hasGlobalSearchWork(parsed);

  if (emptyQuery) {
    return {
      q: parsed.raw,
      parsed: {
        freeText: parsed.freeText,
        freeTextTerms: parsed.freeTextTerms,
        filters: parsed.filters,
        ignoredKeys: parsed.ignoredKeys,
      },
      limitPerGroup,
      emptyQuery: true,
      groups: {
        errors: emptyGroup(),
        events: emptyGroup(),
        sessions: emptyGroup(),
        releases: emptyGroup(),
        users: emptyGroup(),
      },
    };
  }

  const [errors, events, sessions, releases, users] = await Promise.all([
    searchErrors(prisma, projectId, parsed, scope, limitPerGroup),
    searchEvents(prisma, projectId, parsed, scope, limitPerGroup),
    searchSessions(prisma, projectId, parsed, scope, limitPerGroup),
    searchReleases(prisma, projectId, parsed, scope, limitPerGroup),
    searchUsers(prisma, projectId, parsed, scope, limitPerGroup),
  ]);

  return {
    q: parsed.raw,
    parsed: {
      freeText: parsed.freeText,
      freeTextTerms: parsed.freeTextTerms,
      filters: parsed.filters,
      ignoredKeys: parsed.ignoredKeys,
    },
    limitPerGroup,
    emptyQuery: false,
    groups: { errors, events, sessions, releases, users },
  };
}
