import type { PrismaClient } from "@prisma/client";
import { limitsForPlan } from "../config/plans.js";
import { effectivePlanTierForLimits } from "../lib/effective-plan-tier.js";

export type RetentionSweepResult = {
  projectsProcessed: number;
  errorOccurrencesDeleted: number;
  eventsDeleted: number;
  sessionsDeleted: number;
  errorGroupsDeleted: number;
  sourceMapsDeleted: number;
};

export type RetentionSweepOptions = {
  /** When true, count rows that would be deleted without mutating the database. */
  dryRun?: boolean;
};

/**
 * Deletes telemetry rows older than each project's org plan `retentionDays`.
 * Run on a schedule (e.g. nightly cron) via `pnpm --filter api exec tsx src/jobs/run-retention.ts`.
 */
export async function runRetentionSweep(
  prisma: PrismaClient,
  options: RetentionSweepOptions = {}
): Promise<RetentionSweepResult> {
  const { dryRun = false } = options;
  const projects = await prisma.project.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      organization: {
        select: {
          plan_tier: true,
          stripe_subscription_status: true,
          deleted_at: true,
        },
      },
    },
  });

  let errorOccurrencesDeleted = 0;
  let eventsDeleted = 0;
  let sessionsDeleted = 0;
  let errorGroupsDeleted = 0;
  let sourceMapsDeleted = 0;
  let projectsProcessed = 0;

  for (const p of projects) {
    if (p.organization.deleted_at) continue;
    projectsProcessed += 1;
    const effectiveTier = effectivePlanTierForLimits(
      p.organization.plan_tier,
      p.organization.stripe_subscription_status
    );
    const days = limitsForPlan(effectiveTier).retentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const projectId = p.id;

    const r = await prisma.$transaction(async (tx) => {
      const occOldWhere = {
        created_at: { lt: cutoff },
        error_group: { project_id: projectId },
      };
      const occStaleWhere = {
        error_group: { project_id: projectId, last_seen: { lt: cutoff } },
      };
      const evWhere = { project_id: projectId, created_at: { lt: cutoff } };
      const sessWhere = { project_id: projectId, ended_at: { lt: cutoff } };
      const egWhere = { project_id: projectId, last_seen: { lt: cutoff } };

      const occOld = dryRun
        ? null
        : await tx.errorOccurrence.deleteMany({ where: occOldWhere });
      const occStale = dryRun
        ? null
        : await tx.errorOccurrence.deleteMany({ where: occStaleWhere });
      const occCount = dryRun
        ? Number(
            (
              await tx.$queryRaw<[{ count: bigint }]>`
                SELECT COUNT(*)::bigint AS count
                FROM "ErrorOccurrence" AS eo
                INNER JOIN "ErrorGroup" AS eg ON eg.id = eo.error_group_id
                WHERE eg.project_id = ${projectId}
                  AND (
                    eo.created_at < ${cutoff}
                    OR eg.last_seen < ${cutoff}
                  )
              `
            )[0]?.count ?? 0
          )
        : (occOld!.count + occStale!.count);
      const ev = dryRun
        ? { count: await tx.event.count({ where: evWhere }) }
        : await tx.event.deleteMany({ where: evWhere });
      const sess = dryRun
        ? { count: await tx.session.count({ where: sessWhere }) }
        : await tx.session.deleteMany({ where: sessWhere });
      const eg = dryRun
        ? { count: await tx.errorGroup.count({ where: egWhere }) }
        : await tx.errorGroup.deleteMany({ where: egWhere });

      // Keep maps for releases that still have in-window errors (ErrorGroup.last_seen),
      // even when the map was uploaded before the retention cutoff.
      let mapsCount = 0;
      if (dryRun) {
        const rows = await tx.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*)::bigint AS count
            FROM "SourceMapArtifact" AS sma
            WHERE sma.project_id = ${projectId}
              AND sma.uploaded_at < ${cutoff}
              AND NOT EXISTS (
                SELECT 1
                FROM "ErrorGroup" AS eg
                WHERE eg.project_id = sma.project_id
                  AND eg.app = sma.app
                  AND eg.release = sma.release
                  AND eg.last_seen >= ${cutoff}
              )
          `;
        mapsCount = Number(rows[0]?.count ?? 0);
      } else {
        const deleted = await tx.$executeRaw`
            DELETE FROM "SourceMapArtifact" AS sma
            WHERE sma.project_id = ${projectId}
              AND sma.uploaded_at < ${cutoff}
              AND NOT EXISTS (
                SELECT 1
                FROM "ErrorGroup" AS eg
                WHERE eg.project_id = sma.project_id
                  AND eg.app = sma.app
                  AND eg.release = sma.release
                  AND eg.last_seen >= ${cutoff}
              )
          `;
        mapsCount = Number(deleted);
      }

      if (!dryRun) {
        await tx.$executeRaw`
          UPDATE "ErrorGroup" AS eg
          SET occurrences = (
            SELECT COUNT(*)::int FROM "ErrorOccurrence" eo WHERE eo.error_group_id = eg.id
          )
          WHERE eg.project_id = ${projectId}
        `;
      }

      return {
        occ: occCount,
        ev: ev.count,
        sess: sess.count,
        eg: eg.count,
        maps: mapsCount,
      };
    });

    errorOccurrencesDeleted += r.occ;
    eventsDeleted += r.ev;
    sessionsDeleted += r.sess;
    errorGroupsDeleted += r.eg;
    sourceMapsDeleted += r.maps;
  }

  return {
    projectsProcessed,
    errorOccurrencesDeleted,
    eventsDeleted,
    sessionsDeleted,
    errorGroupsDeleted,
    sourceMapsDeleted,
  };
}
