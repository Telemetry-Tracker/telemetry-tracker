import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./lib/db.js";
import { runRetentionSweep } from "./jobs/retention.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("Retention sweep (integration)", () => {
  const organizationIds: string[] = [];

  afterAll(async () => {
    for (const id of organizationIds) {
      await prisma.organization.delete({ where: { id } }).catch(() => {});
    }
  });

  it("does not delete open sessions that started before the retention cutoff", async () => {
    const suffix = randomBytes(8).toString("hex");
    const org = await prisma.organization.create({
      data: {
        name: `Retention org ${suffix}`,
        projects: {
          create: {
            name: "Retention project",
            slug: `retention-${suffix}`,
          },
        },
      },
      include: { projects: true },
    });
    organizationIds.push(org.id);
    const projectId = org.projects[0]!.id;
    const oldStartedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        project_id: projectId,
        session_id: `open-${suffix}`,
        app: "retention-test",
        started_at: oldStartedAt,
      },
    });

    await runRetentionSweep(prisma);

    await expect(
      prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    ).resolves.toMatchObject({ id: session.id, ended_at: null });
  });

  it("deletes sessions whose end time is before the retention cutoff", async () => {
    const suffix = randomBytes(8).toString("hex");
    const org = await prisma.organization.create({
      data: {
        name: `Retention closed org ${suffix}`,
        projects: {
          create: {
            name: "Retention closed project",
            slug: `retention-closed-${suffix}`,
          },
        },
      },
      include: { projects: true },
    });
    organizationIds.push(org.id);
    const projectId = org.projects[0]!.id;
    const oldEndedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        project_id: projectId,
        session_id: `closed-${suffix}`,
        app: "retention-test",
        started_at: new Date(oldEndedAt.getTime() - 60 * 60 * 1000),
        ended_at: oldEndedAt,
      },
    });

    const result = await runRetentionSweep(prisma);

    expect(result.sessionsDeleted).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    ).rejects.toThrow();
  });
});
