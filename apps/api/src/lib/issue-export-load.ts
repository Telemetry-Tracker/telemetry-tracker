import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildErrorOccurrenceScopeWhere,
  fetchImpactMetricsForGroupId,
  fetchScopedOccurrenceSummaryForGroupId,
  listScopedOccurrenceIdsForGroupId,
} from "./errors-list-query.js";
import {
  enrichErrorListFilterForMetrics,
  parseErrorsMetricsAnchor,
} from "./errors-page-summary.js";
import { parseCreatedRange } from "./list-query.js";
import { resolveUnselectedMetricsWindow } from "./overview-metrics-window.js";
import { loadProjectPiiDenyKeys } from "./project-pii-scrub-cache.js";
import { whereErrorGroupById } from "./prisma-project-scope.js";
import { dashboardOriginOrNull } from "./dashboard-origin.js";
import { resolveApiVersion } from "./health.js";
import {
  buildIssueExportDocument,
  type IssueExportV1,
} from "./issue-export.js";

export type ErrorIssueExportQuery = {
  app?: string;
  environment?: string;
  platform?: string;
  release?: string;
  range?: string;
  from?: string;
  to?: string;
  metricsUntil?: string;
  metricsSince?: string;
};

function parseIsoDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Resolve occurrence scope for error detail / export (same rules as GET /errors/:id).
 */
export async function resolveErrorIssueOccurrenceScope(
  prisma: PrismaClient,
  projectId: string,
  errorGroupId: string,
  query: ErrorIssueExportQuery
): Promise<{
  occurrenceScope: {
    platform?: string;
    release?: string;
    gte?: Date;
    lte?: Date;
  };
  occurrenceWhere: Prisma.ErrorOccurrenceWhereInput;
  applyScopedMetrics: boolean;
}> {
  const environment = query.environment?.trim() || undefined;
  const platform = query.platform?.trim() || undefined;
  const release = query.release?.trim() || undefined;
  const rangeKey = query.range?.trim() || undefined;
  const metricsUntilRaw = query.metricsUntil?.trim() || undefined;
  const metricsSinceRaw = query.metricsSince?.trim() || undefined;
  const appFilter = query.app?.trim() || undefined;
  const hasFromTo = Boolean(query.from?.trim() || query.to?.trim());

  const explicitMetricsSince = parseIsoDate(metricsSinceRaw);
  const explicitMetricsUntil = parseIsoDate(metricsUntilRaw);
  const explicitOverviewWindow =
    explicitMetricsSince &&
    explicitMetricsUntil &&
    explicitMetricsSince.getTime() < explicitMetricsUntil.getTime()
      ? { gte: explicitMetricsSince, lte: explicitMetricsUntil }
      : undefined;
  const useIssuesMetricsWindow =
    Boolean(metricsUntilRaw) && !explicitOverviewWindow;
  const isOverviewUnselected =
    !hasFromTo &&
    (rangeKey === "none" || rangeKey === "all") &&
    !useIssuesMetricsWindow &&
    !explicitOverviewWindow;
  const hasBoundedPreset =
    hasFromTo || Boolean(rangeKey && rangeKey !== "all" && rangeKey !== "none");
  const listRange = parseCreatedRange(
    {
      range: query.range,
      from: query.from,
      to: query.to,
    },
    "all"
  );
  const metricsAnchor = parseErrorsMetricsAnchor(metricsUntilRaw);

  let windowGte: Date | undefined;
  let windowLte: Date | undefined;
  if (explicitOverviewWindow) {
    windowGte = explicitOverviewWindow.gte;
    windowLte = explicitOverviewWindow.lte;
  } else if (isOverviewUnselected) {
    const metricsWindow = await resolveUnselectedMetricsWindow(prisma, {
      projectId,
      until: metricsAnchor,
      app: appFilter,
      environment,
      platform,
      release,
    });
    windowGte = metricsWindow.gte;
    windowLte = metricsWindow.lte;
  } else if (hasBoundedPreset) {
    windowGte = listRange.gte;
    windowLte = listRange.lte;
  } else if (platform || release || useIssuesMetricsWindow) {
    const enriched = enrichErrorListFilterForMetrics(
      {
        range: listRange,
        status: "all",
        ...(platform ? { platform } : {}),
        ...(release ? { release } : {}),
      },
      listRange,
      metricsAnchor
    );
    windowGte = enriched.range.gte ?? enriched.occurrenceCountRange?.gte;
    windowLte = enriched.range.lte ?? enriched.occurrenceCountRange?.lte;
  }

  const occurrenceScope = {
    ...(platform ? { platform } : {}),
    ...(release ? { release } : {}),
    ...(windowGte ? { gte: windowGte } : {}),
    ...(windowLte ? { lte: windowLte } : {}),
  };
  const applyScopedMetrics = Boolean(
    platform || release || windowGte || windowLte
  );

  const occurrenceScopeFilter = {
    ...(platform ? { platform } : {}),
    ...(release ? { release } : {}),
    ...(windowGte ? { gte: windowGte } : {}),
    ...(windowLte ? { lte: windowLte } : {}),
  };
  const occurrenceWhere: Prisma.ErrorOccurrenceWhereInput = release
    ? {
        id: {
          in: await listScopedOccurrenceIdsForGroupId(
            prisma,
            errorGroupId,
            projectId,
            occurrenceScopeFilter,
            1
          ),
        },
      }
    : buildErrorOccurrenceScopeWhere(occurrenceScopeFilter);

  return { occurrenceScope, occurrenceWhere, applyScopedMetrics };
}

/** Load and build a scrubbed issue export document, or null if not found. */
export async function loadIssueExportDocument(
  prisma: PrismaClient,
  projectId: string,
  errorGroupId: string,
  query: ErrorIssueExportQuery = {}
): Promise<IssueExportV1 | null> {
  const [project, scope] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId },
      select: { name: true },
    }),
    resolveErrorIssueOccurrenceScope(prisma, projectId, errorGroupId, query),
  ]);
  if (!project) return null;

  const hasOccurrenceFilter = Object.keys(scope.occurrenceWhere).length > 0;
  const group = await prisma.errorGroup.findFirst({
    where: whereErrorGroupById(errorGroupId, projectId),
    include: {
      occurrences_list: {
        where: hasOccurrenceFilter ? scope.occurrenceWhere : undefined,
        orderBy: { created_at: "desc" },
        take: 1,
      },
    },
  });
  if (!group) return null;

  const { enrichErrorGroupWithSymbolicatedStacks } = await import(
    "./stack-symbolicate.js"
  );
  const [enriched, impact, scopedSummary, denyKeys] = await Promise.all([
    enrichErrorGroupWithSymbolicatedStacks(prisma, projectId, group),
    fetchImpactMetricsForGroupId(prisma, errorGroupId, scope.occurrenceScope),
    scope.applyScopedMetrics
      ? fetchScopedOccurrenceSummaryForGroupId(
          prisma,
          errorGroupId,
          scope.occurrenceScope
        )
      : Promise.resolve(null),
    loadProjectPiiDenyKeys(prisma, projectId),
  ]);

  const latest = enriched.occurrences_list[0] ?? null;
  const origin = dashboardOriginOrNull();
  const dashboardUrl = origin
    ? `${origin}/dashboard/errors/${encodeURIComponent(errorGroupId)}`
    : null;
  const symbolicatedTop =
    "symbolicated_top_stack" in enriched &&
    typeof enriched.symbolicated_top_stack === "string"
      ? enriched.symbolicated_top_stack
      : null;

  return buildIssueExportDocument({
    telemetryTrackerVersion: resolveApiVersion(),
    projectName: project.name,
    issue: {
      id: enriched.id,
      message: enriched.message,
      fingerprint: enriched.fingerprint,
      app: enriched.app,
      environment: enriched.environment,
      platform: enriched.platform,
      release: enriched.release,
      occurrences: scopedSummary?.occurrences ?? enriched.occurrences,
      users_affected: impact.users_affected,
      sessions_affected: impact.sessions_affected,
      first_seen: scopedSummary ? scopedSummary.first_seen : enriched.first_seen,
      last_seen: scopedSummary ? scopedSummary.last_seen : enriched.last_seen,
      resolved_at: enriched.resolved_at,
      top_stack: enriched.top_stack,
      symbolicated_top_stack: symbolicatedTop,
      tags: {},
    },
    latestOccurrence: latest
      ? {
          id: latest.id,
          created_at: latest.created_at,
          stack: latest.stack,
          symbolicated_stack:
            "symbolicated_stack" in latest &&
            typeof latest.symbolicated_stack === "string"
              ? latest.symbolicated_stack
              : null,
          context: latest.context,
          user_id: latest.user_id,
          session_id: latest.session_id,
          release: latest.release,
          sdk_version: latest.sdk_version,
        }
      : null,
    dashboardUrl,
    scrubOptions: denyKeys.length > 0 ? { denyKeys } : undefined,
  });
}
