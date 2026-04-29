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
    const count = await prisma.event.count({
      where: {
        project_id: project!.id,
        app: "integration-app",
        name: "integration-event",
      },
    });
    expect(count).toBe(1);
  });
});

describe.skipIf(!runDbIntegration)("POST /ingest/session with API key (integration)", () => {
  let app: FastifyInstance | undefined;
  let organizationId: string | undefined;
  let projectId: string | undefined;
  let fullKey: string;

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
            slug: `vitest-session-${publicId}`,
            api_keys: {
              create: {
                public_id: publicId,
                secret_hash: hashApiKeySecret(publicId, secret),
              },
            },
          },
        },
      },
      include: { projects: true },
    });
    organizationId = org.id;
    projectId = org.projects[0]!.id;

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

  it("records concurrent duplicate session starts once and meters one unit", async () => {
    const payload = {
      app: "integration-app",
      session_id: `session-${randomBytes(8).toString("hex")}`,
      started_at: "2026-03-29T12:00:00.000Z",
    };

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        app!.inject({
          method: "POST",
          url: "/ingest/session",
          headers: {
            authorization: `Bearer ${fullKey}`,
            "content-type": "application/json",
          },
          payload,
        })
      )
    );

    expect(responses.map((res) => res.statusCode)).toEqual([204, 204]);
    const sessionCount = await prisma.session.count({
      where: {
        project_id: projectId!,
        app: payload.app,
        session_id: payload.session_id,
      },
    });
    expect(sessionCount).toBe(1);

    const usage = await prisma.usageMonthly.findFirst({
      where: { project_id: projectId! },
      select: { ingest_units: true },
    });
    expect(usage?.ingest_units).toBe(1);
  });
});
