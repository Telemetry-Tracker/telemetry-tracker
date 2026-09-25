import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { OrgRole, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  createProjectWithPlanLimitCheck,
} from "../lib/plan-enforcement.js";
import { createProjectApiKey } from "../lib/create-project-api-key.js";
import { getSessionUser, requireSessionUser } from "../lib/auth-session.js";
import { getProjectNavSummaries } from "../lib/project-nav-summary.js";
import { loadNavScopeForProject, loadWorkspaceMetaForUser } from "../lib/workspace-meta.js";
import { buildDashboardBootstrap } from "../lib/dashboard-bootstrap.js";
import { buildDashboardSessionContext } from "../lib/dashboard-session-context.js";
import {
  applyNotificationFeedFilters,
  buildDashboardNotifications,
  buildOrganizationDashboardNotifications,
  parseNotificationTypeFilter,
} from "../lib/dashboard-notifications.js";
import {
  parseNotificationPreferences,
  validateNotificationPreferencesPatch,
} from "../lib/notification-preferences.js";
import {
  parseDashboardPreferences,
  validateDashboardPreferencesPatch,
} from "../lib/dashboard-preferences.js";
import {
  parseLabsPreferences,
  validateLabsPreferencesPatch,
} from "../lib/labs-preferences.js";
import { sendOrganizationInviteEmail } from "../lib/notification-email-dispatch.js";
import {
  attachNotificationReadState,
  markNotificationsRead,
} from "../lib/notification-read.js";
import {
  canCreateApiKey,
  canCreateProject,
  canManageMembers,
  canArchiveOrganization,
  canArchiveProject,
  canRevokeApiKey,
  getMembershipRoleForOrganization,
  getMembershipRoleForProject,
} from "../lib/org-permissions.js";
import { readOrganizationIdHeader } from "../lib/http-headers.js";
import {
  allowUnauthenticatedReads,
  resolveReadProjectId,
  resolveReadProjectIdWithSession,
  tryResolveReadProjectId,
} from "../lib/read-project-request.js";
import { dashboardOriginOrNull } from "../lib/dashboard-origin.js";
import { SOURCE_MAP_UPLOAD_BODY_LIMIT } from "../lib/source-map-artifact.js";
import {
  assertSourceMapAppAllowed,
  resolveSourceMapUploadAuth,
} from "../lib/source-map-upload-auth.js";
import { avatarUrlFromUser } from "../lib/user-avatar.js";
import {
  AUDIT_ACTIONS,
  listOrganizationAuditEvents,
  parseAuditLogQuery,
  recordOrganizationAuditEvent,
} from "../lib/audit-log.js";
import { listOrganizationIntegrations } from "../lib/organization-integrations.js";
import {
  ensureUniqueProjectSlug,
  slugifyProjectName,
} from "../lib/project-slug.js";

const DEFAULT_ORG_ID =
  process.env.TELEMETRY_ORGANIZATION_ID?.trim() ||
  "a0000000-0000-4000-8000-000000000001";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INVITE_DAYS = 7;

function parseOrgRole(raw: unknown): OrgRole | null {
  if (raw === "OWNER" || raw === "EDITOR" || raw === "VIEWER") return raw;
  return null;
}

/**
 * Dashboard routes: project list, org members, API key lifecycle.
 */
export async function projectDashboardRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  app.get("/meta/organizations", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const workspace = await loadWorkspaceMetaForUser(prisma, session.userId);
    return reply.send({ organizations: workspace.organizations });
  });

  app.post("/meta/organizations", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const body = (request.body ?? {}) as { name?: string };
    const name =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim().slice(0, 120)
        : "";
    if (!name) {
      return reply.status(400).send({ error: "name is required" });
    }
    const org = await prisma.organization.create({
      data: {
        name,
        memberships: {
          create: {
            user_id: session.userId,
            role: OrgRole.OWNER,
          },
        },
      },
      select: { id: true, name: true },
    });
    return reply.status(201).send({ id: org.id, name: org.name });
  });

  app.patch<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId",
    async (request, reply) => {
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const existing = await prisma.organization.findFirst({
        where: { id: orgId, deleted_at: null },
        select: { id: true, name: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Organization not found" });
      }
      const role = await getMembershipRoleForOrganization(session.userId, orgId);
      if (!canArchiveOrganization(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const body = (request.body ?? {}) as { name?: string };
      if (typeof body.name !== "string") {
        return reply.status(400).send({ error: "name is required" });
      }
      const name = body.name.trim().slice(0, 120);
      if (!name) {
        return reply.status(400).send({ error: "name cannot be empty" });
      }
      if (name === existing.name) {
        return reply.send({ id: existing.id, name: existing.name });
      }
      const updated = await prisma.organization.update({
        where: { id: orgId },
        data: { name },
        select: { id: true, name: true },
      });
      void recordOrganizationAuditEvent(
        prisma,
        orgId,
        session.userId,
        AUDIT_ACTIONS.ORGANIZATION_UPDATE,
        `organization:${updated.id} name=${updated.name}`
      );
      return reply.send({ id: updated.id, name: updated.name });
    }
  );

  app.get("/meta/dashboard-bootstrap", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const headerOrg = readOrganizationIdHeader(request);
    const result = await buildDashboardBootstrap(prisma, session, request, headerOrg);
    if (!result.ok) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return reply.send(result.payload);
  });

  app.get("/meta/workspace", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const headerOrg = readOrganizationIdHeader(request);
    const workspace = await loadWorkspaceMetaForUser(prisma, session.userId, headerOrg);
    if (workspace.forbiddenOrg) {
      return reply.status(403).send({ error: "Not a member of this organization" });
    }

    const query = request.query as { includeNavScope?: string; app?: string | string[] };
    const includeNavScope =
      query.includeNavScope === "1" || query.includeNavScope === "true";
    let navScope: { apps: string[]; environments: string[] } | undefined;

    if (includeNavScope) {
      const projectId = await resolveReadProjectIdWithSession(request, reply, session);
      if (projectId === null) return;
      const appFilter = typeof query.app === "string" ? query.app.trim() || undefined : undefined;
      navScope = await loadNavScopeForProject(prisma, projectId, appFilter);
    }

    return reply.send({
      organizations: workspace.organizations,
      projects: workspace.projects,
      ...(navScope ? { navScope } : {}),
    });
  });

  app.get("/meta/nav-scope", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const query = request.query as { app?: string | string[] };
    const raw = Array.isArray(query.app) ? query.app[0] : query.app;
    const appFilter = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    const navScope = await loadNavScopeForProject(prisma, projectId, appFilter);
    return reply.send(navScope);
  });

  app.get("/meta/projects", async (request, reply) => {
    const session = await getSessionUser(request);
    const headerOrg = readOrganizationIdHeader(request);

    if (session) {
      const workspace = await loadWorkspaceMetaForUser(prisma, session.userId, headerOrg);
      if (workspace.forbiddenOrg) {
        return reply.status(403).send({ error: "Not a member of this organization" });
      }
      return reply.send({ projects: workspace.projects });
    }

    if (headerOrg) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!allowUnauthenticatedReads()) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const projects = await prisma.project.findMany({
      where: { organization_id: DEFAULT_ORG_ID, deleted_at: null },
      select: { id: true, name: true, slug: true, organization_id: true },
      orderBy: { name: "asc" },
    });
    return reply.send({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        organizationId: p.organization_id,
      })),
    });
  });

  app.get("/meta/projects/nav-summary", async (request, reply) => {
    const session = await getSessionUser(request);
    const headerOrg = readOrganizationIdHeader(request);

    if (!session && !allowUnauthenticatedReads()) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    let filterIds: string[] = [];
    if (session) {
      const orgRows = await prisma.organizationMembership.findMany({
        where: { user_id: session.userId, organization: { deleted_at: null } },
        select: { organization_id: true },
      });
      filterIds = [...new Set(orgRows.map((r) => r.organization_id))];
      if (filterIds.length === 0) {
        return reply.send({ summaries: [] });
      }
      if (headerOrg) {
        if (!filterIds.includes(headerOrg)) {
          return reply.status(403).send({ error: "Not a member of this organization" });
        }
        filterIds = [headerOrg];
      }
    } else if (headerOrg) {
      return reply.status(401).send({ error: "Unauthorized" });
    } else {
      filterIds = [DEFAULT_ORG_ID];
    }

    const projects = await prisma.project.findMany({
      where: {
        organization_id: { in: filterIds },
        deleted_at: null,
        organization: { deleted_at: null },
      },
      select: { id: true },
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summaries = await getProjectNavSummaries(
      prisma,
      projects.map((p) => p.id),
      since
    );

    return reply.send({ summaries });
  });

  app.post("/meta/projects", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const body = (request.body ?? {}) as {
      organizationId?: string;
      name?: string;
      slug?: string;
    };
    const orgId =
      typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    if (!orgId || !UUID_RE.test(orgId)) {
      return reply.status(400).send({ error: "organizationId must be a UUID" });
    }
    const role = await getMembershipRoleForOrganization(session.userId, orgId);
    if (!canCreateProject(role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const name =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim().slice(0, 120)
        : "";
    if (!name) {
      return reply.status(400).send({ error: "name is required" });
    }
    const slugBase =
      typeof body.slug === "string" && body.slug.trim() !== ""
        ? slugifyProjectName(body.slug.trim())
        : slugifyProjectName(name);
    const slug = await ensureUniqueProjectSlug(prisma, orgId, slugBase);

    const created = await createProjectWithPlanLimitCheck(prisma, orgId, { name, slug });
    if (!created.ok) {
      if (created.code === "org_not_found") {
        return reply.status(403).send({ error: created.error });
      }
      return reply
        .status(403)
        .send({ error: created.error, code: "max_projects_per_org" });
    }
    const project = created.project;
    return reply.status(201).send({
      id: project.id,
      name: project.name,
      slug: project.slug,
      organizationId: project.organization_id,
    });
  });

  app.patch<{ Params: { projectId: string } }>(
    "/meta/projects/:projectId",
    async (request, reply) => {
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const projectId = request.params.projectId.trim();
      if (!UUID_RE.test(projectId)) {
        return reply.status(400).send({ error: "Invalid project id" });
      }
      const existing = await prisma.project.findFirst({
        where: {
          id: projectId,
          deleted_at: null,
          organization: { deleted_at: null },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          organization_id: true,
        },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Project not found" });
      }
      const role = await getMembershipRoleForOrganization(
        session.userId,
        existing.organization_id
      );
      if (!canCreateProject(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const body = (request.body ?? {}) as { name?: string; slug?: string };
      const nameProvided = typeof body.name === "string";
      const slugProvided = typeof body.slug === "string";
      if (!nameProvided && !slugProvided) {
        return reply
          .status(400)
          .send({ error: "name or slug is required" });
      }

      let nextName = existing.name;
      if (nameProvided) {
        const trimmed = body.name!.trim().slice(0, 120);
        if (!trimmed) {
          return reply.status(400).send({ error: "name cannot be empty" });
        }
        nextName = trimmed;
      }

      let nextSlug = existing.slug;
      if (slugProvided) {
        const raw = body.slug!.trim();
        if (!raw) {
          return reply.status(400).send({ error: "slug cannot be empty" });
        }
        const desired = slugifyProjectName(raw);
        if (desired !== existing.slug) {
          const clash = await prisma.project.findFirst({
            where: {
              organization_id: existing.organization_id,
              slug: desired,
              id: { not: projectId },
            },
            select: { id: true },
          });
          if (clash) {
            return reply
              .status(409)
              .send({ error: "slug already in use in this organization" });
          }
          nextSlug = desired;
        }
      }

      if (nextName === existing.name && nextSlug === existing.slug) {
        return reply.send({
          id: existing.id,
          name: existing.name,
          slug: existing.slug,
          organizationId: existing.organization_id,
        });
      }

      let updated: {
        id: string;
        name: string;
        slug: string;
        organization_id: string;
      };
      try {
        updated = await prisma.project.update({
          where: { id: projectId },
          data: { name: nextName, slug: nextSlug },
          select: {
            id: true,
            name: true,
            slug: true,
            organization_id: true,
          },
        });
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          (e as { code: string }).code === "P2002"
        ) {
          return reply
            .status(409)
            .send({ error: "slug already in use in this organization" });
        }
        throw e;
      }

      void recordOrganizationAuditEvent(
        prisma,
        existing.organization_id,
        session.userId,
        AUDIT_ACTIONS.PROJECT_UPDATE,
        `project:${updated.id} name=${updated.name} slug=${updated.slug}`
      );

      return reply.send({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        organizationId: updated.organization_id,
      });
    }
  );

  app.post<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId/archive",
    async (request, reply) => {
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const role = await getMembershipRoleForOrganization(session.userId, orgId);
      if (!canArchiveOrganization(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const org = await prisma.organization.findFirst({
        where: { id: orgId, deleted_at: null },
        select: { id: true },
      });
      if (!org) {
        return reply.status(404).send({ error: "Organization not found" });
      }
      await prisma.organization.update({
        where: { id: orgId },
        data: { deleted_at: new Date() },
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/meta/projects/:projectId/archive",
    async (request, reply) => {
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const projectId = request.params.projectId.trim();
      if (!UUID_RE.test(projectId)) {
        return reply.status(400).send({ error: "Invalid project id" });
      }
      const project = await prisma.project.findFirst({
        where: { id: projectId, deleted_at: null },
        select: { id: true, organization_id: true },
      });
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
      const role = await getMembershipRoleForOrganization(
        session.userId,
        project.organization_id
      );
      if (!canArchiveProject(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      await prisma.project.update({
        where: { id: projectId },
        data: { deleted_at: new Date() },
      });
      return reply.status(204).send();
    }
  );

  app.get("/meta/invites/preview", async (request, reply) => {
    const q = request.query as { token?: string };
    const token = typeof q.token === "string" ? q.token.trim() : "";
    if (!token) {
      return reply.send({ valid: false });
    }
    const invite = await prisma.organizationInvite.findUnique({
      where: { token },
      include: { organization: { select: { name: true, deleted_at: true } } },
    });
    if (
      !invite ||
      invite.organization.deleted_at != null ||
      invite.expires_at.getTime() <= Date.now()
    ) {
      return reply.send({ valid: false });
    }
    return reply.send({
      valid: true,
      organizationName: invite.organization.name,
      email: invite.email,
      role: invite.role,
    });
  });

  app.post<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId/members",
    async (request, reply) => {
      const session = await getSessionUser(request);
      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const role = await getMembershipRoleForOrganization(session.userId, orgId);
      if (!canManageMembers(role)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const body = (request.body ?? {}) as { email?: string; role?: string };
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const newRole = parseOrgRole(body.role);
      if (!email.includes("@")) {
        return reply.status(400).send({ error: "Invalid email" });
      }
      if (!newRole) {
        return reply.status(400).send({ error: "role must be OWNER, EDITOR, or VIEWER" });
      }

      const target = await prisma.user.findUnique({ where: { email } });
      if (target) {
        const addExisting = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
          );
          const org = await tx.organization.findFirst({
            where: { id: orgId, deleted_at: null },
            select: { id: true },
          });
          if (!org) {
            return { kind: "org_unavailable" as const };
          }
          const existing = await tx.organizationMembership.findUnique({
            where: {
              user_id_organization_id: {
                user_id: target.id,
                organization_id: orgId,
              },
            },
          });
          if (existing) {
            return { kind: "already_member" as const };
          }
          try {
            const membership = await tx.organizationMembership.create({
              data: {
                user_id: target.id,
                organization_id: orgId,
                role: newRole,
              },
            });
            return { kind: "added" as const, membershipId: membership.id };
          } catch (e: unknown) {
            if (
              typeof e === "object" &&
              e !== null &&
              "code" in e &&
              (e as { code: string }).code === "P2002"
            ) {
              return { kind: "already_member" as const };
            }
            throw e;
          }
        });
        if (addExisting.kind === "org_unavailable") {
          return reply.status(404).send({ error: "Organization not found or archived" });
        }
        if (addExisting.kind === "already_member") {
          return reply.status(409).send({ error: "User is already a member" });
        }
        const { notifyTeamMemberJoinedEmail } = await import(
          "../lib/notification-email-dispatch.js"
        );
        void notifyTeamMemberJoinedEmail(prisma, orgId, {
          membershipId: addExisting.membershipId,
          email: target.email,
          displayName: target.display_name,
          role: newRole,
        });
        return reply.status(201).send({ status: "added" as const });
      }

      const base = dashboardOriginOrNull();
      if (!base) {
        return reply.status(503).send({ error: "Dashboard origin is not configured" });
      }

      const inviteResult = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
        );
        const org = await tx.organization.findFirst({
          where: { id: orgId, deleted_at: null },
          select: { id: true },
        });
        if (!org) {
          return { kind: "org_unavailable" as const };
        }
        const newToken = randomBytes(32).toString("hex");
        const exp = new Date(
          Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000
        );
        const row = await tx.organizationInvite.upsert({
          where: {
            organization_id_email: {
              organization_id: orgId,
              email,
            },
          },
          create: {
            organization_id: orgId,
            email,
            role: newRole,
            token: newToken,
            expires_at: exp,
            invited_by_id: session.userId,
          },
          update: {
            role: newRole,
            token: newToken,
            expires_at: exp,
            invited_by_id: session.userId,
          },
        });
        return { kind: "invited" as const, token: row.token, inviteId: row.id };
      });

      if (inviteResult.kind === "org_unavailable") {
        return reply.status(404).send({ error: "Organization not found or archived" });
      }
      const token = inviteResult.token;

      const inviteUrl = `${base}/register?invite=${encodeURIComponent(token)}`;

      void sendOrganizationInviteEmail(
        prisma,
        { id: inviteResult.inviteId, email, token },
        inviteUrl
      );

      return reply.status(201).send({
        status: "invited" as const,
        inviteUrl,
        inviteToken: token,
      });
    }
  );

  app.patch<{ Params: { orgId: string; userId: string } }>(
    "/meta/organizations/:orgId/members/:userId",
    async (request, reply) => {
      const session = await getSessionUser(request);
      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const orgId = request.params.orgId.trim();
      const targetUserId = request.params.userId.trim();
      if (!UUID_RE.test(orgId) || !UUID_RE.test(targetUserId)) {
        return reply.status(400).send({ error: "Invalid id" });
      }
      const actorRole = await getMembershipRoleForOrganization(session.userId, orgId);
      if (!canManageMembers(actorRole)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const body = (request.body ?? {}) as { role?: string };
      const newRole = parseOrgRole(body.role);
      if (!newRole) {
        return reply.status(400).send({ error: "role must be OWNER, EDITOR, or VIEWER" });
      }

      const patchResult = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
        );
        const membership = await tx.organizationMembership.findUnique({
          where: {
            user_id_organization_id: {
              user_id: targetUserId,
              organization_id: orgId,
            },
          },
        });
        if (!membership) {
          return { status: 404 as const, error: "Member not found" };
        }
        if (membership.role === OrgRole.OWNER && newRole !== OrgRole.OWNER) {
          const ownerCount = await tx.organizationMembership.count({
            where: { organization_id: orgId, role: OrgRole.OWNER },
          });
          if (ownerCount <= 1) {
            return {
              status: 400 as const,
              error: "Cannot change role of the last owner",
            };
          }
        }
        await tx.organizationMembership.update({
          where: {
            user_id_organization_id: {
              user_id: targetUserId,
              organization_id: orgId,
            },
          },
          data: { role: newRole },
        });
        return { status: 204 as const };
      });
      if (patchResult.status !== 204) {
        return reply
          .status(patchResult.status)
          .send({ error: patchResult.error });
      }
      return reply.status(204).send();
    }
  );

  /**
   * Role and capability flags: project-scoped actions use membership for `X-Project-Id`;
   * org-scoped actions use `X-Organization-Id` when set so they match the sidebar org, not the
   * project cookie’s organization.
   */
  app.get("/meta/session-context", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const sessionContext = await buildDashboardSessionContext(prisma, session, request);
    if (sessionContext === null) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    return reply.send(sessionContext);
  });

  app.get("/meta/notifications", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const sessionContext = await buildDashboardSessionContext(prisma, session, request);
    if (sessionContext === null) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const query = request.query as {
      scope?: unknown;
      type?: unknown;
      projectId?: unknown;
      unread?: unknown;
    };
    const scope = query.scope === "organization" ? "organization" : "project";
    const typeFilter = parseNotificationTypeFilter(query.type);
    const filterProjectId =
      typeof query.projectId === "string" && /^[0-9a-f-]{36}$/i.test(query.projectId.trim())
        ? query.projectId.trim().toLowerCase()
        : null;
    const unreadOnly = query.unread === "1" || query.unread === "true";

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, notification_preferences: true },
    });
    const preferences = parseNotificationPreferences(user?.notification_preferences);
    const projectId = sessionContext.projectId || null;
    const headerOrg = readOrganizationIdHeader(request);
    const memberships = await prisma.organizationMembership.findMany({
      where: { user_id: session.userId },
      select: { organization_id: true },
    });
    let organizationIds = memberships.map((m) => m.organization_id);
    if (headerOrg && organizationIds.includes(headerOrg)) {
      organizationIds = [headerOrg];
    }
    const buildContext = user
      ? {
          userId: session.userId,
          userEmail: user.email,
          organizationIds,
        }
      : undefined;

    const workspace = await loadWorkspaceMetaForUser(prisma, session.userId, headerOrg);
    const orgProjects = workspace.projects.map((p) => ({
      id: p.id,
      name: p.name,
    }));

    if (filterProjectId) {
      const allowed = new Set(orgProjects.map((p) => p.id.toLowerCase()));
      if (!allowed.has(filterProjectId)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
    }

    // When filtering by project, scope the DB queries to that project before
    // take/caps so quieter projects are not crowded out by a global org cap.
    const projectsForOrgFeed =
      scope === "organization" && filterProjectId
        ? orgProjects.filter((p) => p.id.toLowerCase() === filterProjectId)
        : orgProjects;

    let items =
      scope === "organization"
        ? await buildOrganizationDashboardNotifications(
            prisma,
            projectsForOrgFeed,
            projectId,
            sessionContext,
            preferences,
            buildContext,
            { mode: "center" }
          )
        : await buildDashboardNotifications(
            prisma,
            projectId,
            sessionContext,
            preferences,
            buildContext,
            {
              mode: "bell",
              projectMeta: projectId
                ? orgProjects.find((p) => p.id === projectId) ?? {
                    id: projectId,
                    name: "Project",
                  }
                : null,
            }
          );

    items = applyNotificationFeedFilters(items, {
      types: typeFilter,
      projectId: filterProjectId,
    });

    let withRead = await attachNotificationReadState(prisma, session.userId, items);
    if (unreadOnly) {
      withRead = withRead.filter((item) => item.unread);
    }

    return reply.send({
      items: withRead,
      projects: orgProjects,
      scope,
    });
  });

  app.post("/meta/notifications/read", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;

    const body = (request.body ?? {}) as {
      ids?: unknown;
      all?: unknown;
      scope?: unknown;
    };
    const sessionContext = await buildDashboardSessionContext(prisma, session, request);
    if (sessionContext === null) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    if (body.all === true) {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { email: true, notification_preferences: true },
      });
      const preferences = parseNotificationPreferences(user?.notification_preferences);
      const headerOrg = readOrganizationIdHeader(request);
      const memberships = await prisma.organizationMembership.findMany({
        where: { user_id: session.userId },
        select: { organization_id: true },
      });
      let organizationIds = memberships.map((m) => m.organization_id);
      if (headerOrg && organizationIds.includes(headerOrg)) {
        organizationIds = [headerOrg];
      }
      const buildContext = user
        ? {
            userId: session.userId,
            userEmail: user.email,
            organizationIds,
          }
        : undefined;
      const scope = body.scope === "organization" ? "organization" : "project";
      const workspace = await loadWorkspaceMetaForUser(prisma, session.userId, headerOrg);
      const orgProjects = workspace.projects.map((p) => ({
        id: p.id,
        name: p.name,
      }));
      const projectId = sessionContext.projectId || null;
      const items =
        scope === "organization"
          ? await buildOrganizationDashboardNotifications(
              prisma,
              orgProjects,
              projectId,
              sessionContext,
              preferences,
              buildContext,
              { mode: "center", forReadPersistence: true }
            )
          : await buildDashboardNotifications(
              prisma,
              projectId,
              sessionContext,
              preferences,
              buildContext,
              { forReadPersistence: true }
            );
      await markNotificationsRead(
        prisma,
        session.userId,
        items.map((item) => item.id)
      );
      return reply.send({ ok: true });
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (ids.length === 0) {
      return reply.status(400).send({ error: "Provide ids or all: true" });
    }
    await markNotificationsRead(prisma, session.userId, ids);
    return reply.send({ ok: true });
  });

  app.get("/meta/notification-preferences", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { notification_preferences: true },
    });
    return reply.send({
      preferences: parseNotificationPreferences(user?.notification_preferences),
    });
  });

  app.patch("/meta/notification-preferences", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;

    const existing = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { notification_preferences: true },
    });
    const previous = parseNotificationPreferences(existing?.notification_preferences);
    const parsed = validateNotificationPreferencesPatch(request.body, previous);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { notification_preferences: parsed.preferences },
    });

    return reply.send({ preferences: parsed.preferences });
  });

  app.get("/meta/dashboard-preferences", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { dashboard_preferences: true },
    });
    return reply.send({
      preferences: parseDashboardPreferences(user?.dashboard_preferences),
    });
  });

  app.patch("/meta/dashboard-preferences", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;

    const parsed = validateDashboardPreferencesPatch(request.body);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { dashboard_preferences: parsed.preferences },
    });

    return reply.send({ preferences: parsed.preferences });
  });

  app.get("/meta/labs-preferences", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { labs_preferences: true },
    });
    return reply.send({
      preferences: parseLabsPreferences(user?.labs_preferences),
    });
  });

  app.patch("/meta/labs-preferences", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;

    const parsed = validateLabsPreferencesPatch(request.body);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { labs_preferences: parsed.preferences },
    });

    return reply.send({ preferences: parsed.preferences });
  });

  app.get<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId/audit-log",
    async (request, reply) => {
      const session = await getSessionUser(request);
      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const membership = await prisma.organizationMembership.findFirst({
        where: { user_id: session.userId, organization_id: orgId },
        select: { id: true },
      });
      if (!membership) {
        return reply.status(403).send({ error: "Not a member of this organization" });
      }
      const org = await prisma.organization.findFirst({
        where: { id: orgId, deleted_at: null },
        select: { id: true },
      });
      if (!org) {
        return reply.status(404).send({ error: "Organization not found or archived" });
      }

      const q = request.query as { limit?: string; cursor?: string };
      const parsed = parseAuditLogQuery(q);
      if ("error" in parsed) {
        return reply.status(400).send({ error: parsed.error });
      }

      const { events, nextCursor } = await listOrganizationAuditEvents(
        prisma,
        orgId,
        parsed
      );
      return reply.send({ organizationId: orgId, events, nextCursor });
    }
  );

  app.get<{ Params: { orgId: string } }>(
    "/meta/organizations/:orgId/integrations",
    async (request, reply) => {
      const session = await getSessionUser(request);
      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }
      const membership = await prisma.organizationMembership.findFirst({
        where: { user_id: session.userId, organization_id: orgId },
        select: { id: true },
      });
      if (!membership) {
        return reply.status(403).send({ error: "Not a member of this organization" });
      }
      const org = await prisma.organization.findFirst({
        where: { id: orgId, deleted_at: null },
        select: { id: true },
      });
      if (!org) {
        return reply.status(404).send({ error: "Organization not found or archived" });
      }

      const headerProjectId = await tryResolveReadProjectId(request);
      let scopedProjectId: string | null = null;
      if (headerProjectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: headerProjectId,
            organization_id: orgId,
            deleted_at: null,
          },
          select: { id: true },
        });
        if (project) scopedProjectId = project.id;
      }

      const payload = await listOrganizationIntegrations(prisma, orgId, scopedProjectId);
      return reply.send(payload);
    }
  );

  app.get("/meta/members", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const q = request.query as { organizationId?: string };
    let orgId =
      typeof q.organizationId === "string" ? q.organizationId.trim() : "";
    if (!orgId) {
      const first = await prisma.organizationMembership.findFirst({
        where: { user_id: session.userId },
        orderBy: { created_at: "asc" },
        select: { organization_id: true },
      });
      orgId = first?.organization_id ?? "";
    }
    if (!orgId) {
      return reply.send({ organizationId: null, members: [] });
    }
    const ok = await prisma.organizationMembership.findFirst({
      where: { user_id: session.userId, organization_id: orgId },
    });
    if (!ok) {
      return reply.status(403).send({ error: "Not a member of this organization" });
    }
    const rows = await prisma.organizationMembership.findMany({
      where: { organization_id: orgId },
      select: {
        role: true,
        created_at: true,
        user: { select: { id: true, email: true, display_name: true, avatar_key: true, avatar_updated_at: true } },
      },
      orderBy: { created_at: "desc" },
    });
    return reply.send({
      organizationId: orgId,
      members: rows.map((r) => ({
        userId: r.user.id,
        email: r.user.email,
        displayName: r.user.display_name,
        avatarUrl: avatarUrlFromUser(r.user),
        role: r.role,
        joinedAt: r.created_at.toISOString(),
      })),
    });
  });

  app.get("/project/alert-settings", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { loadProjectAlertSettings } = await import("../lib/error-spike-alert.js");
    const settings = await loadProjectAlertSettings(prisma, projectId);
    return reply.send({ settings });
  });

  app.patch("/project/alert-settings", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { loadProjectAlertSettings } = await import("../lib/error-spike-alert.js");
    const { validateProjectAlertSettingsPatch } = await import(
      "../lib/project-alert-settings.js"
    );
    const { saveProjectAlertSettings } = await import(
      "../lib/builtin-alert-rules.js"
    );
    const previous = await loadProjectAlertSettings(prisma, projectId);
    const validated = validateProjectAlertSettingsPatch(request.body, previous);
    if (!validated.ok) {
      return reply.status(400).send({ error: validated.error });
    }
    // Dual-write: alert_settings JSON + SYSTEM AlertRule rows (#535).
    await saveProjectAlertSettings(prisma, projectId, validated.settings);
    return reply.send({ settings: validated.settings });
  });

  app.get("/project/pii-scrub-settings", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const row = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { pii_scrub_settings: true },
    });
    const { parseProjectPiiScrubSettings } = await import(
      "../lib/project-pii-scrub-settings.js"
    );
    return reply.send({
      settings: parseProjectPiiScrubSettings(row?.pii_scrub_settings ?? null),
    });
  });

  app.patch("/project/pii-scrub-settings", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const {
      parseProjectPiiScrubSettings,
      validateProjectPiiScrubSettingsPatch,
      formatPiiScrubSettingsAuditTarget,
    } = await import("../lib/project-pii-scrub-settings.js");
    const existingRow = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { pii_scrub_settings: true, organization_id: true },
    });
    if (!existingRow) {
      return reply.status(404).send({ error: "Project not found" });
    }
    const previous = parseProjectPiiScrubSettings(existingRow.pii_scrub_settings);
    const validated = validateProjectPiiScrubSettingsPatch(request.body, previous);
    if (!validated.ok) {
      return reply.status(400).send({ error: validated.error });
    }
    await prisma.project.update({
      where: { id: projectId },
      data: { pii_scrub_settings: validated.settings as object },
    });
    const { clearProjectPiiScrubSettingsCache } = await import(
      "../lib/project-pii-scrub-cache.js"
    );
    clearProjectPiiScrubSettingsCache(projectId);
    void recordOrganizationAuditEvent(
      prisma,
      existingRow.organization_id,
      session.userId,
      AUDIT_ACTIONS.PROJECT_PII_SCRUB_UPDATE,
      formatPiiScrubSettingsAuditTarget(projectId, validated.settings)
    );
    return reply.send({ settings: validated.settings });
  });

  app.get("/project/alert-events", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const q = request.query as { limit?: string };
    const limitRaw = typeof q.limit === "string" ? Number(q.limit) : 25;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(50, Math.max(1, Math.floor(limitRaw)))
      : 25;
    const { listRecentAlertEvents } = await import("../lib/alert-dispatch.js");
    const events = await listRecentAlertEvents(prisma, projectId, limit);
    return reply.send({
      events: events.map((e) => ({
        id: e.id,
        rule: e.rule,
        title: e.title,
        body: e.body,
        href: e.href,
        firedAt: e.fired_at.toISOString(),
      })),
    });
  });

  app.get("/project/alert-rules", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { listAlertRules } = await import("../lib/alert-rules.js");
    const rules = await listAlertRules(prisma, projectId);
    return reply.send({ rules });
  });

  app.post("/project/alert-rules", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { createAlertRule } = await import("../lib/alert-rules.js");
    const result = await createAlertRule(prisma, projectId, request.body);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.status(201).send({ rule: result.rule });
  });

  app.patch("/project/alert-rules/:ruleId", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { ruleId } = request.params as { ruleId: string };
    const { updateAlertRule } = await import("../lib/alert-rules.js");
    const result = await updateAlertRule(prisma, projectId, ruleId, request.body);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.send({ rule: result.rule });
  });

  app.delete("/project/alert-rules/:ruleId", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { ruleId } = request.params as { ruleId: string };
    const { softDeleteAlertRule } = await import("../lib/alert-rules.js");
    const result = await softDeleteAlertRule(prisma, projectId, ruleId);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.status(204).send();
  });

  app.get("/project/webhooks", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const { listProjectWebhooks } = await import("../lib/alert-webhook-dispatch.js");
    const webhooks = await listProjectWebhooks(prisma, projectId);
    return reply.send({ webhooks });
  });

  app.get("/project/webhook-deliveries", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const q = request.query as { limit?: string; webhookId?: string };
    const limitRaw = typeof q.limit === "string" ? Number(q.limit) : 25;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(50, Math.max(1, Math.floor(limitRaw)))
      : 25;
    const webhookId =
      typeof q.webhookId === "string" && q.webhookId.trim().length > 0
        ? q.webhookId.trim()
        : undefined;
    const { listAlertWebhookDeliveries } = await import("../lib/alert-webhook-dispatch.js");
    const deliveries = await listAlertWebhookDeliveries(prisma, projectId, {
      limit,
      webhookId,
    });
    return reply.send({ deliveries });
  });

  app.post("/project/webhooks", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = (request.body ?? {}) as {
      url?: unknown;
      label?: unknown;
      enabled?: unknown;
      withSigningSecret?: unknown;
      provider?: unknown;
      config?: unknown;
    };
    const { createProjectWebhook } = await import("../lib/alert-webhook-dispatch.js");
    const result = await createProjectWebhook(prisma, projectId, {
      url: typeof body.url === "string" ? body.url : "",
      label: typeof body.label === "string" ? body.label : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      withSigningSecret:
        typeof body.withSigningSecret === "boolean" ? body.withSigningSecret : undefined,
      provider: body.provider,
      config: body.config,
    });
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.status(201).send({
      webhook: result.webhook,
      signingSecret: result.signingSecret,
    });
  });

  app.patch("/project/webhooks/:webhookId", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { webhookId } = request.params as { webhookId: string };
    const body = (request.body ?? {}) as {
      url?: unknown;
      label?: unknown;
      enabled?: unknown;
      rotateSigningSecret?: unknown;
      clearSigningSecret?: unknown;
      config?: unknown;
    };
    const { updateProjectWebhook } = await import("../lib/alert-webhook-dispatch.js");
    const result = await updateProjectWebhook(prisma, projectId, webhookId, {
      url: typeof body.url === "string" ? body.url : undefined,
      label:
        body.label === null
          ? null
          : typeof body.label === "string"
            ? body.label
            : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      rotateSigningSecret: body.rotateSigningSecret === true,
      clearSigningSecret: body.clearSigningSecret === true,
      config: body.config,
    });
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.send({
      webhook: result.webhook,
      signingSecret: result.signingSecret,
    });
  });

  app.delete("/project/webhooks/:webhookId", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { webhookId } = request.params as { webhookId: string };
    const { softDeleteProjectWebhook } = await import("../lib/alert-webhook-dispatch.js");
    const result = await softDeleteProjectWebhook(prisma, projectId, webhookId);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.status(204).send();
  });

  app.post("/project/webhooks/:webhookId/test", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { webhookId } = request.params as { webhookId: string };
    const { sendTestWebhook } = await import("../lib/alert-webhook-dispatch.js");
    const result = await sendTestWebhook(prisma, projectId, webhookId);
    if (!result.ok) {
      return reply.status(result.status).send({
        error: result.error,
        httpStatus: result.httpStatus ?? null,
      });
    }
    return reply.send({ ok: true, httpStatus: result.httpStatus });
  });

  app.get("/project/api-keys", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const keys = await prisma.apiKey.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        public_id: true,
        name: true,
        allowed_app: true,
        source_map_upload: true,
        created_at: true,
        last_used_at: true,
        revoked_at: true,
        expires_at: true,
      },
    });
    return reply.send({
      keys: keys.map((k) => ({
        id: k.id,
        publicId: k.public_id,
        name: k.name,
        allowedApp: k.allowed_app,
        sourceMapUpload: k.source_map_upload,
        createdAt: k.created_at.toISOString(),
        lastUsedAt: k.last_used_at?.toISOString() ?? null,
        revokedAt: k.revoked_at?.toISOString() ?? null,
        expiresAt: k.expires_at?.toISOString() ?? null,
      })),
    });
  });

  app.post("/project/api-keys", async (request, reply) => {
    const session = await requireSessionUser(request, reply);
    if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (projectId === null) return;
    const projRole = await getMembershipRoleForProject(session.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = (request.body ?? {}) as {
      name?: string;
      allowedApp?: string;
      sourceMapUpload?: boolean;
    };
    const name =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim().slice(0, 120)
        : null;
    let allowedApp: string | null = null;
    if (typeof body.allowedApp === "string" && body.allowedApp.trim() !== "") {
      allowedApp = body.allowedApp.trim().slice(0, 64);
    }

    const keyCreated = await createProjectApiKey(prisma, projectId, {
      name,
      allowedApp,
      sourceMapUpload: body.sourceMapUpload === true,
    });
    if (!keyCreated.ok) {
      if (keyCreated.code === "project_not_found") {
        return reply.status(403).send({ error: keyCreated.error });
      }
      return reply
        .status(403)
        .send({ error: keyCreated.error, code: "max_api_keys_per_project" });
    }

    return reply.status(201).send({
      key: keyCreated.key.fullKey,
      publicId: keyCreated.key.publicId,
      name: keyCreated.key.name,
      allowedApp: keyCreated.key.allowedApp,
      sourceMapUpload: keyCreated.key.sourceMapUpload,
      message:
        "Copy this key now. It will not be shown again. Store it as a secret (e.g. environment variable).",
    });
  });

  app.post<{ Params: { publicId: string } }>(
    "/project/api-keys/:publicId/revoke",
    async (request, reply) => {
      const session = await requireSessionUser(request, reply);
      if (!session) return;
      const projectId = await resolveReadProjectIdWithSession(request, reply, session);
      if (projectId === null) return;
      const projRole = await getMembershipRoleForProject(session.userId, projectId);
      if (!canRevokeApiKey(projRole)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const publicId = request.params.publicId.toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(publicId)) {
        return reply.status(400).send({ error: "Invalid publicId" });
      }
      const r = await prisma.apiKey.updateMany({
        where: {
          project_id: projectId,
          public_id: publicId,
          deleted_at: null,
        },
        data: { revoked_at: new Date() },
      });
      if (r.count === 0) {
        return reply.status(404).send({ error: "Key not found" });
      }
      return reply.status(204).send();
    }
  );

  app.post(
    "/project/source-maps",
    { bodyLimit: SOURCE_MAP_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const auth = await resolveSourceMapUploadAuth(prisma, request, reply);
      if (!auth) return;
      const { validateSourceMapUploadBody, upsertSourceMapArtifact, SOURCE_MAP_QUOTA_MSG } =
        await import("../lib/source-map-upload.js");
      const validated = validateSourceMapUploadBody(request.body);
      if (!validated.ok) {
        return reply.status(400).send({ error: validated.error });
      }
      if (!assertSourceMapAppAllowed(auth, validated.input.app, reply)) return;
      const result = await upsertSourceMapArtifact(prisma, auth.projectId, validated.input);
      if (!result.ok) {
        return reply
          .status(result.error === SOURCE_MAP_QUOTA_MSG ? 403 : 400)
          .send({ error: result.error });
      }
      return reply.status(result.created ? 201 : 200).send({
        artifact: result.artifact,
      });
    }
  );

  app.get("/project/source-maps", async (request, reply) => {
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const q = request.query as { app?: string; release?: string };
    const appLabel = typeof q.app === "string" ? q.app.trim() : "";
    const release = typeof q.release === "string" ? q.release.trim() : "";
    if (!appLabel || !release) {
      return reply.status(400).send({ error: "app and release query params are required" });
    }
    const { listSourceMapArtifactSummaries } = await import("../lib/source-map-upload.js");
    const artifacts = await listSourceMapArtifactSummaries(
      prisma,
      projectId,
      appLabel,
      release
    );
    return reply.send({ artifacts });
  });
}
