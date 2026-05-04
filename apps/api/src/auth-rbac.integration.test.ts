import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { OrgRole } from "@prisma/client";
import { createApp } from "./app.js";
import { hashPassword } from "./lib/password.js";
import { prisma } from "./lib/db.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("Auth and RBAC (integration)", () => {
  let app: FastifyInstance | undefined;
  let organizationId: string | undefined;
  let projectId: string;
  let otherOrganizationId: string | undefined;
  let otherProjectId: string | undefined;
  let errorGroupId: string;
  let emailViewer: string;
  let emailEditor: string;
  let prevTelemetryPublicDashboard: string | undefined;
  let prevNextPublicTelemetryPublicDashboard: string | undefined;
  const password = "testpass12";
  let prevTelemetryProjectId: string | undefined;

  beforeAll(async () => {
    prevTelemetryProjectId = process.env.TELEMETRY_PROJECT_ID;
    prevTelemetryPublicDashboard = process.env.TELEMETRY_PUBLIC_DASHBOARD;
    prevNextPublicTelemetryPublicDashboard =
      process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD;
    delete process.env.TELEMETRY_PROJECT_ID;
    delete process.env.TELEMETRY_PUBLIC_DASHBOARD;
    delete process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD;

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

    const otherOrg = await prisma.organization.create({
      data: {
        name: `Other RBAC org ${suffix}`,
        projects: {
          create: {
            name: "Other RBAC project",
            slug: `other-rbac-${suffix}`,
          },
        },
      },
      include: { projects: true },
    });
    otherOrganizationId = otherOrg.id;
    otherProjectId = otherOrg.projects[0]!.id;

    app = await createApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    }
    if (otherOrganizationId) {
      await prisma.organization.delete({ where: { id: otherOrganizationId } }).catch(() => {});
    }
    // Users do not cascade from Organization; login tests also create UserSession rows (cascade on User delete).
    const testEmails = [emailViewer, emailEditor].filter(Boolean);
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(() => {});
    }
    if (prevTelemetryProjectId === undefined) delete process.env.TELEMETRY_PROJECT_ID;
    else process.env.TELEMETRY_PROJECT_ID = prevTelemetryProjectId;
    if (prevTelemetryPublicDashboard === undefined) delete process.env.TELEMETRY_PUBLIC_DASHBOARD;
    else process.env.TELEMETRY_PUBLIC_DASHBOARD = prevTelemetryPublicDashboard;
    if (prevNextPublicTelemetryPublicDashboard === undefined) {
      delete process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD;
    } else {
      process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD =
        prevNextPublicTelemetryPublicDashboard;
    }
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

  it("GET /api/meta/projects returns 401 without a session", async () => {
    const res = await app!.inject({ method: "GET", url: "/api/meta/projects" });
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

  it("GET /api/overview returns 401 without a session even with a valid project id", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/api/overview",
      headers: { "x-project-id": projectId },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/project/api-keys returns 401 without a session", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/api/project/api-keys",
      headers: { "x-project-id": projectId },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/overview returns 403 for a project outside the user's organizations", async () => {
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: emailViewer, password },
    });
    const { sessionId } = JSON.parse(login.body) as { sessionId: string };

    const res = await app!.inject({
      method: "GET",
      url: "/api/overview",
      headers: {
        authorization: `Bearer ${sessionId}`,
        "x-project-id": otherProjectId!,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/overview returns 403 when fallback project is outside the user's organizations", async () => {
    const previousProjectId = process.env.TELEMETRY_PROJECT_ID;
    process.env.TELEMETRY_PROJECT_ID = otherProjectId!;
    try {
      const login = await app!.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: emailViewer, password },
      });
      const { sessionId } = JSON.parse(login.body) as { sessionId: string };

      const res = await app!.inject({
        method: "GET",
        url: "/api/overview",
        headers: { authorization: `Bearer ${sessionId}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      if (previousProjectId === undefined) delete process.env.TELEMETRY_PROJECT_ID;
      else process.env.TELEMETRY_PROJECT_ID = previousProjectId;
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
});
