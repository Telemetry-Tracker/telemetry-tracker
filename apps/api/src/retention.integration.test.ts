import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runRetentionSweep } from "./jobs/retention.js";
import { prisma } from "./lib/db.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("retention sweep (integration)", () => {
  let organizationId: string | undefined;

  afterAll(async () => {
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
  });

  it("keeps open sessions and sessions that ended after the retention cutoff", async () => {
    const suffix = randomBytes(8).toString("hex");
    const now = Date.now();
    const oldStartedAt = new Date(now - 20 * 24 * 60 * 60 * 1000);
    const oldEndedAt = new Date(now - 16 * 24 * 60 * 60 * 1000);
    const recentEndedAt = new Date(now - 2 * 24 * 60 * 60 * 1000);

    const org = await prisma.organization.create({
      data: {
        name: `Retention org ${suffix}`,
        plan_tier: "FREE",
        projects: {
          create: {
            name: "Retention project",
            slug: `retention-${suffix}`,
            sessions: {
              create: [
                {
                  session_id: `open-${suffix}`,
                  app: "retention-app",
                  started_at: oldStartedAt,
                },
                {
                  session_id: `recent-end-${suffix}`,
                  app: "retention-app",
                  started_at: oldStartedAt,
                  ended_at: recentEndedAt,
                },
                {
                  session_id: `old-end-${suffix}`,
                  app: "retention-app",
                  started_at: oldStartedAt,
                  ended_at: oldEndedAt,
                },
              ],
            },
          },
        },
      },
      include: { projects: true },
    });
    organizationId = org.id;
    const projectId = org.projects[0]!.id;

    await runRetentionSweep(prisma);

    const remaining = await prisma.session.findMany({
      where: { project_id: projectId },
      select: { session_id: true },
      orderBy: { session_id: "asc" },
    });
    expect(remaining.map((s) => s.session_id)).toEqual([
      `open-${suffix}`,
      `recent-end-${suffix}`,
    ]);
    const result = await runRetentionSweep(prisma);
    expect(result.sessionsDeleted).toBe(0);
  });
});
