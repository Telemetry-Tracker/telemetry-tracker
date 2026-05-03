import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { hashApiKeySecret } from "./lib/api-key-auth.js";
import { prisma } from "./lib/db.js";

/** Opt-in so local `pnpm test` does not require a reachable DB; CI sets this in the Test step. */
const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("POST /ingest/event with API key (integration)", () => {
  let app: FastifyInstance | undefined;
  let organizationId: string | undefined;
  let fullKey: string;
  let projectId: string | undefined;

  beforeAll(async () => {
    const publicId = randomBytes(16).toString("hex");
    const secret = randomBytes(16).toString("hex");
    fullKey = `tt_live_${publicId}_${secret}`;

    const org = await prisma.organization.create({
      data: {
        name: `Vitest org ${publicId.slice(0, 8)}`,
        projects: {
          create: {
            name: "Vitest project",
            slug: `vitest-${publicId}`,
            api_keys: {
              create: {
                public_id: publicId,
                secret_hash: hashApiKeySecret(publicId, secret),
              },
            },
          },
        },
      },
    });
    organizationId = org.id;

    app = await createApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (organizationId) {
      await prisma.organization
        .delete({ where: { id: organizationId } })
        .catch(() => {});
    }
  });

  it("returns 204 and persists an Event row", async () => {
    const res = await app!.inject({
      method: "POST",
      url: "/ingest/event",
      headers: {
        authorization: `Bearer ${fullKey}`,
        "content-type": "application/json",
      },
      payload: { app: "integration-app", name: "integration-event" },
    });
    expect(res.statusCode).toBe(204);

    const project = await prisma.project.findFirst({
      where: { organization_id: organizationId! },
    });
    expect(project).not.toBeNull();
    projectId = project!.id;
    const count = await prisma.event.count({
      where: {
        project_id: project!.id,
        app: "integration-app",
        name: "integration-event",
      },
    });
    expect(count).toBe(1);
  });

  it("treats duplicate session starts as idempotent and bills once", async () => {
    const sessionId = `session-${randomBytes(8).toString("hex")}`;
    const project =
      projectId ??
      (
        await prisma.project.findFirst({
          where: { organization_id: organizationId! },
        })
      )?.id;
    expect(project).toBeDefined();
    const beforeUsage = await prisma.usageMonthly.findFirst({
      where: { project_id: project! },
      select: { ingest_units: true },
    });
    const headers = {
      authorization: `Bearer ${fullKey}`,
      "content-type": "application/json",
    };
    const payload = { app: "integration-app", session_id: sessionId };

    const first = await app!.inject({
      method: "POST",
      url: "/ingest/session",
      headers,
      payload,
    });
    const retry = await app!.inject({
      method: "POST",
      url: "/ingest/session",
      headers,
      payload,
    });

    expect(first.statusCode).toBe(204);
    expect(retry.statusCode).toBe(204);

    const sessionCount = await prisma.session.count({
      where: {
        project_id: project!,
        app: "integration-app",
        session_id: sessionId,
      },
    });
    expect(sessionCount).toBe(1);
    const afterUsage = await prisma.usageMonthly.findFirst({
      where: { project_id: project! },
      orderBy: { updated_at: "desc" },
      select: { ingest_units: true },
    });
    expect(afterUsage?.ingest_units ?? 0).toBe((beforeUsage?.ingest_units ?? 0) + 1);
  });
});
