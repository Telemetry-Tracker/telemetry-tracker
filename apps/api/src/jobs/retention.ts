import type { PrismaClient } from "@prisma/client";
import { limitsForPlan } from "../config/plans.js";
import { effectivePlanTierForLimits } from "../lib/effective-plan-tier.js";

export type RetentionSweepResult = {
  projectsProcessed: number;
  errorOccurrencesDeleted: number;
  eventsDeleted: number;
  sessionsDeleted: number;
  errorGroupsDeleted: number;
};

/**
 * Deletes telemetry rows older than each project's org plan `retentionDays`.
 * Run on a schedule (e.g. nightly cron) via `pnpm --filter api exec tsx src/jobs/run-retention.ts`.
 */
export async function runRetentionSweep(prisma: PrismaClient): Promise<RetentionSweepResult> {
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
      const occOld = await tx.errorOccurrence.deleteMany({
        where: {
          created_at: { lt: cutoff },
          error_group: { project_id: projectId },
        },
      });
      const occStale = await tx.errorOccurrence.deleteMany({
        where: {
          error_group: { project_id: projectId, last_seen: { lt: cutoff } },
        },
      });
      const ev = await tx.event.deleteMany({
        where: { project_id: projectId, created_at: { lt: cutoff } },
      });
      const sess = await tx.session.deleteMany({
        where: { project_id: projectId, ended_at: { lt: cutoff } },
      });
      const eg = await tx.errorGroup.deleteMany({
        where: { project_id: projectId, last_seen: { lt: cutoff } },
      });
      await tx.$executeRaw`
        UPDATE "ErrorGroup" AS eg
        SET occurrences = (
          SELECT COUNT(*)::int FROM "ErrorOccurrence" eo WHERE eo.error_group_id = eg.id
        )
        WHERE eg.project_id = ${projectId}
      `;
      return {
        occ: occOld.count + occStale.count,
        ev: ev.count,
        sess: sess.count,
        eg: eg.count,
      };
    });

    errorOccurrencesDeleted += r.occ;
    eventsDeleted += r.ev;
    sessionsDeleted += r.sess;
    errorGroupsDeleted += r.eg;
  }

  return {
    projectsProcessed,
    errorOccurrencesDeleted,
    eventsDeleted,
    sessionsDeleted,
    errorGroupsDeleted,
  };
}
