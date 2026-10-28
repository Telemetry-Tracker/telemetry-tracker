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

describe.skipIf(!runDbIntegration)("POST /ingest/session concurrent requests (TT-031)", () => {
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
        name: `Vitest session ${publicId.slice(0, 8)}`,
        projects: {
          create: {
            name: "Vitest session project",
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
    });
    organizationId = org.id;
    const project = await prisma.project.findFirst({
      where: { organization_id: organizationId },
    });
    projectId = project!.id;

    app = await createApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (organizationId) {
      await prisma.organization
        .delete({ where: { id: organizationId } })
        .catch(() => {});
    }
  });

  it("prevents duplicate sessions when init() and identify() are concurrent", async () => {
    const sessionId = randomBytes(16).toString("hex");
    const appName = "test-app";
    const startedAt = new Date().toISOString();

    // Simulate SDK: init() starts session, identify() immediately updates with user info
    const [initRes, identifyRes] = await Promise.all([
      // init() call: POST session with session_id
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          platform: "react-native",
          anonymous_id: "anon-123",
          started_at: startedAt,
        },
      }),
      // identify() call: POST session with same session_id + user info
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          platform: "react-native",
          user_id: "user-456",
          user_email: "test@example.com",
          anonymous_id: "anon-123",
          started_at: startedAt,
        },
      }),
    ]);

    expect(initRes.statusCode).toBe(204);
    expect(identifyRes.statusCode).toBe(204);

    // Verify only ONE session was created (not duplicate)
    const sessions = await prisma.session.findMany({
      where: {
        project_id: projectId!,
        session_id: sessionId,
      },
    });

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;

    // Verify the session merged both requests' data
    expect(session.app).toBe(appName);
    expect(session.platform).toBe("react-native");
    expect(session.anonymous_id).toBe("anon-123");
    expect(session.user_id).toBe("user-456");
    expect(session.user_email).toBe("test@example.com");
    expect(session.ended_at).toBeNull();
  });

  it("handles triple concurrent session requests without duplicates", async () => {
    const sessionId = randomBytes(16).toString("hex");
    const appName = "test-app-triple";
    const startedAt = new Date().toISOString();

    // Simulate even more concurrent requests (e.g., init + identify + event with session)
    const [res1, res2, res3] = await Promise.all([
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          started_at: startedAt,
        },
      }),
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          user_id: "user-789",
          started_at: startedAt,
        },
      }),
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          country: "US",
          started_at: startedAt,
        },
      }),
    ]);

    expect(res1.statusCode).toBe(204);
    expect(res2.statusCode).toBe(204);
    expect(res3.statusCode).toBe(204);

    const sessions = await prisma.session.findMany({
      where: {
        project_id: projectId!,
        session_id: sessionId,
      },
    });

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.user_id).toBe("user-789");
    expect(session.country).toBe("US");
  });

  it("preserves ended_at from any concurrent request", async () => {
    const sessionId = randomBytes(16).toString("hex");
    const appName = "test-app-ended";
    const startedAt = new Date();
    const endedAt = new Date(startedAt.getTime() + 5000);

    // One request starts the session, another ends it concurrently
    const [startRes, endRes] = await Promise.all([
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          started_at: startedAt.toISOString(),
        },
      }),
      app!.inject({
        method: "POST",
        url: "/ingest/session",
        headers: {
          authorization: `Bearer ${fullKey}`,
          "content-type": "application/json",
        },
        payload: {
          session_id: sessionId,
          app: appName,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
        },
      }),
    ]);

    expect(startRes.statusCode).toBe(204);
    expect(endRes.statusCode).toBe(204);

    const sessions = await prisma.session.findMany({
      where: {
        project_id: projectId!,
        session_id: sessionId,
      },
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.ended_at).toEqual(endedAt);
  });
});
