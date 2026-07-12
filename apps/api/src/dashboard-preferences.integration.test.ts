import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { hashPassword } from "./lib/password.js";
import { prisma } from "./lib/db.js";
import { DEFAULT_DASHBOARD_PREFERENCES } from "./lib/dashboard-preferences.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("Dashboard preferences (integration)", () => {
  let app: FastifyInstance | undefined;
  let email: string;
  const password = "testpass12";

  beforeAll(async () => {
    const suffix = randomBytes(8).toString("hex");
    email = `prefs-${suffix}@test.local`;

    await prisma.user.create({
      data: {
        email,
        password_hash: hashPassword(password),
      },
    });

    app = await createApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (email) {
      await prisma.user.deleteMany({ where: { email } }).catch(() => {});
    }
  });

  async function loginSessionId(): Promise<string> {
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const { sessionId } = JSON.parse(login.body) as { sessionId: string };
    return sessionId;
  }

  it("GET /api/meta/dashboard-preferences returns defaults without stored prefs", async () => {
    const sessionId = await loginSessionId();
    const res = await app!.inject({
      method: "GET",
      url: "/api/meta/dashboard-preferences",
      headers: { authorization: `Bearer ${sessionId}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { preferences: typeof DEFAULT_DASHBOARD_PREFERENCES };
    expect(body.preferences).toEqual(DEFAULT_DASHBOARD_PREFERENCES);
  });

  it("PATCH /api/meta/dashboard-preferences persists and returns updated prefs", async () => {
    const sessionId = await loginSessionId();
    const updated = {
      defaultTimeRange: "7d" as const,
      compactTableDensity: true,
      showResolvedIssues: true,
      usageAnalytics: false,
    };

    const patch = await app!.inject({
      method: "PATCH",
      url: "/api/meta/dashboard-preferences",
      headers: {
        authorization: `Bearer ${sessionId}`,
        "content-type": "application/json",
      },
      payload: updated,
    });
    expect(patch.statusCode).toBe(200);
    const patchBody = JSON.parse(patch.body) as { preferences: typeof updated };
    expect(patchBody.preferences).toEqual(updated);

    const get = await app!.inject({
      method: "GET",
      url: "/api/meta/dashboard-preferences",
      headers: { authorization: `Bearer ${sessionId}` },
    });
    expect(get.statusCode).toBe(200);
    const getBody = JSON.parse(get.body) as { preferences: typeof updated };
    expect(getBody.preferences).toEqual(updated);
  });

  it("GET /api/meta/dashboard-preferences returns 401 without session", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/api/meta/dashboard-preferences",
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /api/meta/dashboard-preferences returns 400 for invalid payload", async () => {
    const sessionId = await loginSessionId();
    const res = await app!.inject({
      method: "PATCH",
      url: "/api/meta/dashboard-preferences",
      headers: {
        authorization: `Bearer ${sessionId}`,
        "content-type": "application/json",
      },
      payload: { defaultTimeRange: "90d" },
    });
    expect(res.statusCode).toBe(400);
  });
});
