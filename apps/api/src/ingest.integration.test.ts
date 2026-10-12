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
    // Let fire-and-forget quota alerts from ingest settle before cascade-deleting the org.
    await new Promise<void>((resolve) => setImmediate(resolve));
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
    expect(project!.first_event_at).toBeInstanceOf(Date);
    const firstReceipt = project!.first_event_at;
    const retry = await app!.inject({
      method: "POST", url: "/ingest/event",
      headers: { authorization: `Bearer ${fullKey}` },
      payload: { app: "integration-app", name: "second-event" },
    });
    expect(retry.statusCode).toBe(204);
    const afterRetry = await prisma.project.findUnique({ where: { id: project!.id } });
    expect(afterRetry!.first_event_at).toEqual(firstReceipt);
    // Raw retention removes events, never the durable funnel fact.
    await prisma.event.deleteMany({ where: { project_id: project!.id, name: "second-event" } });
    const afterRetention = await prisma.project.findUnique({ where: { id: project!.id } });
    expect(afterRetention!.first_event_at).toEqual(firstReceipt);
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
