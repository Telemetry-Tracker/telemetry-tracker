import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { OrgRole } from "@prisma/client";
import { createApp } from "./app.js";
import { hashPassword } from "./lib/password.js";
import { DEFAULT_LEGACY_PROJECT_ID } from "./lib/project-scope.js";
import { prisma } from "./lib/db.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("Auth and RBAC (integration)", () => {
  let app: FastifyInstance | undefined;
  let organizationId: string | undefined;
  let projectId: string;
  let errorGroupId: string;
  let emailViewer: string;
  let emailEditor: string;
  const password = "testpass12";
  let prevTelemetryProjectId: string | undefined;

  beforeAll(async () => {
    prevTelemetryProjectId = process.env.TELEMETRY_PROJECT_ID;
    delete process.env.TELEMETRY_PROJECT_ID;

    const suffix = randomBytes(8).toString("hex");
    emailViewer = `viewer-${suffix}@test.local`;
    emailEditor = `editor-${suffix}@test.local`;

    const org = await prisma.organization.create({
      data: {
        name: `Auth RBAC org ${suffix}`,
        projects: {
          create: {
            name: "RBAC project",
            slug: `rbac-${suffix}`,
          },
        },
      },
      include: { projects: true },
    });
    organizationId = org.id;
    projectId = org.projects[0]!.id;

    await prisma.user.create({
      data: {
        email: emailViewer,
        password_hash: hashPassword(password),
        memberships: {
          create: {
            organization_id: org.id,
            role: OrgRole.VIEWER,
          },
        },
      },
    });

    await prisma.user.create({
      data: {
        email: emailEditor,
        password_hash: hashPassword(password),
        memberships: {
          create: {
            organization_id: org.id,
            role: OrgRole.EDITOR,
          },
        },
      },
    });

    const eg = await prisma.errorGroup.create({
      data: {
        project_id: projectId,
        fingerprint: `fp-rbac-${suffix}`,
        message: "rbac test error",
        app: "test-app",
      },
    });
    errorGroupId = eg.id;

    app = await createApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
    // Users do not cascade from Organization; login tests also create UserSession rows (cascade on User delete).
    const testEmails = [emailViewer, emailEditor].filter(Boolean);
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => {});
    }
    if (prevTelemetryProjectId === undefined) delete process.env.TELEMETRY_PROJECT_ID;
    else process.env.TELEMETRY_PROJECT_ID = prevTelemetryProjectId;
  });

  it("POST /api/auth/login rejects wrong password with 401", async () => {
    const res = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error?: string };
    expect(body.error).toBeDefined();
  });

  it("GET /api/auth/me returns 401 without session", async () => {
    const res = await app!.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/auth/login succeeds and GET /api/auth/me returns user", async () => {
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = JSON.parse(login.body) as { sessionId: string };
    expect(loginBody.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const me = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${loginBody.sessionId}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = JSON.parse(me.body) as {
      user: { email: string };
      memberships: { role: string; organizationId: string }[];
    };
    expect(meBody.user.email).toBe(emailViewer);
    expect(meBody.memberships.some((m) => m.role === "VIEWER")).toBe(true);
  });

  it("PATCH /api/auth/me updates displayName for authenticated user", async () => {
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    expect(login.statusCode).toBe(200);
    const { sessionId } = JSON.parse(login.body) as { sessionId: string };

    const patch = await app!.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: {
        authorization: `Bearer ${sessionId}`,
        "content-type": "application/json",
      },
      payload: { displayName: "Updated Editor" },
    });
    expect(patch.statusCode).toBe(200);
    const patchBody = JSON.parse(patch.body) as {
      user: { displayName: string | null; email: string };
    };
    expect(patchBody.user.displayName).toBe("Updated Editor");
    expect(patchBody.user.email).toBe(emailEditor);

    const me = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionId}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = JSON.parse(me.body) as { user: { displayName: string | null } };
    expect(meBody.user.displayName).toBe("Updated Editor");
  });

  it("POST /api/auth/me/avatar uploads and serves avatar for org members", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const editorLogin = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    const { sessionId: editorSession } = JSON.parse(editorLogin.body) as {
      sessionId: string;
    };

    const upload = await app!.inject({
      method: "POST",
      url: "/api/auth/me/avatar",
      headers: {
        authorization: `Bearer ${editorSession}`,
        "content-type": "image/png",
      },
      payload: png,
    });
    expect(upload.statusCode).toBe(200);
    const uploadBody = JSON.parse(upload.body) as {
      user: { avatarUrl: string | null };
    };
    expect(uploadBody.user.avatarUrl).toMatch(/^\/api\/auth\/avatars\//);

    const viewerLogin = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    const { sessionId: viewerSession } = JSON.parse(viewerLogin.body) as {
      sessionId: string;
    };

    const editorUser = await prisma.user.findUnique({
      where: { email: emailEditor },
      select: { id: true },
    });
    const avatar = await app!.inject({
      method: "GET",
      url: uploadBody.user.avatarUrl!,
      headers: { authorization: `Bearer ${viewerSession}` },
    });
    expect(avatar.statusCode).toBe(200);
    expect(avatar.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(avatar.rawPayload)).toEqual(png);

    const staleVersion = await app!.inject({
      method: "GET",
      url: `/api/auth/avatars/${editorUser!.id}?v=1`,
      headers: { authorization: `Bearer ${viewerSession}` },
    });
    expect(staleVersion.statusCode).toBe(200);
    expect(staleVersion.headers["content-type"]).toBe("image/png");
    expect(staleVersion.headers["cache-control"]).toBe("private, no-cache");
    expect(Buffer.from(staleVersion.rawPayload)).toEqual(png);

    const forbidden = await app!.inject({
      method: "GET",
      url: `/api/auth/avatars/${editorUser!.id}`,
      headers: { authorization: `Bearer ${editorSession}` },
    });
    expect(forbidden.statusCode).toBe(200);

    const removed = await app!.inject({
      method: "DELETE",
      url: "/api/auth/me/avatar",
      headers: { authorization: `Bearer ${editorSession}` },
    });
    expect(removed.statusCode).toBe(200);
    const removedBody = JSON.parse(removed.body) as {
      user: { avatarUrl: string | null };
    };
    expect(removedBody.user.avatarUrl).toBeNull();
  });

  it("GET /api/auth/avatars/:userId returns 403 for shared membership in deleted org", async () => {
    const suffix = randomBytes(8).toString("hex");
    const emailA = `deleted-org-a-${suffix}@test.local`;
    const emailB = `deleted-org-b-${suffix}@test.local`;

    const org = await prisma.organization.create({
      data: { name: `Deleted org ${suffix}` },
    });

    await prisma.user.create({
      data: {
        email: emailA,
        password_hash: hashPassword(password),
        memberships: {
          create: { organization_id: org.id, role: OrgRole.EDITOR },
        },
      },
    });
    await prisma.user.create({
      data: {
        email: emailB,
        password_hash: hashPassword(password),
        memberships: {
          create: { organization_id: org.id, role: OrgRole.VIEWER },
        },
      },
    });

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const loginA = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailA, password },
    });
    const { sessionId: sessionA } = JSON.parse(loginA.body) as {
      sessionId: string;
    };

    const upload = await app!.inject({
      method: "POST",
      url: "/api/auth/me/avatar",
      headers: {
        authorization: `Bearer ${sessionA}`,
        "content-type": "image/png",
      },
      payload: png,
    });
    expect(upload.statusCode).toBe(200);

    const userA = await prisma.user.findUnique({
      where: { email: emailA },
      select: { id: true },
    });

    await prisma.organization.update({
      where: { id: org.id },
      data: { deleted_at: new Date() },
    });

    const loginB = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailB, password },
    });
    const { sessionId: sessionB } = JSON.parse(loginB.body) as {
      sessionId: string;
    };

    const avatar = await app!.inject({
      method: "GET",
      url: `/api/auth/avatars/${userA!.id}`,
      headers: { authorization: `Bearer ${sessionB}` },
    });
    expect(avatar.statusCode).toBe(403);

    await prisma.user.deleteMany({
      where: { email: { in: [emailA, emailB] } },
    });
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  });

  it("avatar routes return 503 when R2 is not configured in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevR2 = {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    };
    process.env.NODE_ENV = "production";
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;

    try {
      const editorLogin = await app!.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: emailEditor, password },
      });
      const { sessionId: editorSession } = JSON.parse(editorLogin.body) as {
        sessionId: string;
      };
      const editorUser = await prisma.user.findUnique({
        where: { email: emailEditor },
        select: { id: true },
      });

      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      );

      const upload = await app!.inject({
        method: "POST",
        url: "/api/auth/me/avatar",
        headers: {
          authorization: `Bearer ${editorSession}`,
          "content-type": "image/png",
        },
        payload: png,
      });
      expect(upload.statusCode).toBe(503);

      const avatarGet = await app!.inject({
        method: "GET",
        url: `/api/auth/avatars/${editorUser!.id}`,
        headers: { authorization: `Bearer ${editorSession}` },
      });
      expect(avatarGet.statusCode).toBe(503);

      const removed = await app!.inject({
        method: "DELETE",
        url: "/api/auth/me/avatar",
        headers: { authorization: `Bearer ${editorSession}` },
      });
      expect(removed.statusCode).toBe(503);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      for (const [key, value] of Object.entries(prevR2)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("PATCH /api/auth/me returns 401 without session", async () => {
    const res = await app!.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: { "content-type": "application/json" },
      payload: { displayName: "Nobody" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/errors returns 401 without session in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowReads = process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS;
    process.env.NODE_ENV = "production";
    delete process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS;

    try {
      const res = await app!.inject({
        method: "GET",
        url: "/api/errors",
        headers: { "x-project-id": projectId },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { error?: string };
      expect(body.error).toBe("Unauthorized");
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevAllowReads === undefined) delete process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS;
      else process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS = prevAllowReads;
    }
  });

  it("PATCH /api/errors/:id returns 403 for VIEWER", async () => {
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    const { sessionId } = JSON.parse(login.body) as { sessionId: string };

    const res = await app!.inject({
      method: "PATCH",
      url: `/api/errors/${errorGroupId}`,
      headers: {
        authorization: `Bearer ${sessionId}`,
        "x-project-id": projectId,
        "content-type": "application/json",
      },
      payload: { resolved: true },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error?: string };
    expect(body.error).toBe("Forbidden");
  });

  it("GET /api/apps rejects authenticated fallback project access without membership", async () => {
    await prisma.event.create({
      data: {
        project_id: DEFAULT_LEGACY_PROJECT_ID,
        app: "fallback-private-app",
        name: "fallback-private-event",
      },
    });

    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    const { sessionId } = JSON.parse(login.body) as { sessionId: string };

    const noHeader = await app!.inject({
      method: "GET",
      url: "/api/apps",
      headers: { authorization: `Bearer ${sessionId}` },
    });
    expect(noHeader.statusCode).toBe(403);

    const invalidHeader = await app!.inject({
      method: "GET",
      url: "/api/apps",
      headers: {
        authorization: `Bearer ${sessionId}`,
        "x-project-id": "00000000-0000-4000-8000-000000000099",
      },
    });
    expect(invalidHeader.statusCode).toBe(403);

    const ownProject = await app!.inject({
      method: "GET",
      url: "/api/apps",
      headers: {
        authorization: `Bearer ${sessionId}`,
        "x-project-id": projectId,
      },
    });
    expect(ownProject.statusCode).toBe(200);
  });

  it("PATCH /api/errors/:id returns 200 for EDITOR", async () => {
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    const { sessionId } = JSON.parse(login.body) as { sessionId: string };

    const res = await app!.inject({
      method: "PATCH",
      url: `/api/errors/${errorGroupId}`,
      headers: {
        authorization: `Bearer ${sessionId}`,
        "x-project-id": projectId,
        "content-type": "application/json",
      },
      payload: { resolved: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { resolved_at: string | null };
    expect(body.resolved_at).not.toBeNull();
  });

  it("GET /api/auth/sessions lists active sessions with current flag", async () => {
    const loginA = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      payload: { email: emailViewer, password },
    });
    expect(loginA.statusCode).toBe(200);
    const { sessionId: sessionA } = JSON.parse(loginA.body) as { sessionId: string };

    const loginB = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
      payload: { email: emailViewer, password },
    });
    expect(loginB.statusCode).toBe(200);
    const { sessionId: sessionB } = JSON.parse(loginB.body) as { sessionId: string };

    const list = await app!.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${sessionB}` },
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body) as {
      sessions: {
        id: string;
        current: boolean;
        deviceBrowser: string | null;
        deviceOs: string | null;
      }[];
    };
    expect(body.sessions.length).toBeGreaterThanOrEqual(2);
    const current = body.sessions.find((s) => s.id === sessionB);
    const other = body.sessions.find((s) => s.id === sessionA);
    expect(current?.current).toBe(true);
    expect(current?.deviceBrowser).toBe("Safari");
    expect(current?.deviceOs).toBe("iOS");
    expect(other?.current).toBe(false);
    expect(other?.deviceBrowser).toBe("Chrome");
    expect(other?.deviceOs).toBe("macOS");
  });

  it("DELETE /api/auth/sessions/:id revokes another session", async () => {
    const loginA = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    const { sessionId: sessionA } = JSON.parse(loginA.body) as { sessionId: string };

    const loginB = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    const { sessionId: sessionB } = JSON.parse(loginB.body) as { sessionId: string };

    const revoke = await app!.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${sessionA}`,
      headers: { authorization: `Bearer ${sessionB}` },
    });
    expect(revoke.statusCode).toBe(204);

    const me = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionA}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it("DELETE /api/auth/sessions/others revokes all but current session", async () => {
    const loginA = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    const { sessionId: sessionA } = JSON.parse(loginA.body) as { sessionId: string };

    await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });

    const loginC = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    const { sessionId: sessionC } = JSON.parse(loginC.body) as { sessionId: string };

    const revokeOthers = await app!.inject({
      method: "DELETE",
      url: "/api/auth/sessions/others",
      headers: { authorization: `Bearer ${sessionC}` },
    });
    expect(revokeOthers.statusCode).toBe(200);
    const revokedBody = JSON.parse(revokeOthers.body) as { revoked: number };
    expect(revokedBody.revoked).toBeGreaterThanOrEqual(2);

    const meA = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionA}` },
    });
    expect(meA.statusCode).toBe(401);

    const meC = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionC}` },
    });
    expect(meC.statusCode).toBe(200);
  });

  it("POST /api/auth/change-password updates password and revokes other sessions", async () => {
    const loginA = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    const { sessionId: sessionA } = JSON.parse(loginA.body) as { sessionId: string };

    const loginB = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    const { sessionId: sessionB } = JSON.parse(loginB.body) as { sessionId: string };

    const newPassword = "newpass987";
    const change = await app!.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: {
        authorization: `Bearer ${sessionB}`,
        "content-type": "application/json",
      },
      payload: { currentPassword: password, newPassword },
    });
    expect(change.statusCode).toBe(200);

    const meA = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionA}` },
    });
    expect(meA.statusCode).toBe(401);

    const meB = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionB}` },
    });
    expect(meB.statusCode).toBe(200);

    const oldLogin = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailEditor, password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);

    await prisma.user.update({
      where: { email: emailEditor },
      data: { password_hash: hashPassword(password) },
    });
  });
});
