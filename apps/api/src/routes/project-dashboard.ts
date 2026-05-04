import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { OrgRole, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  createApiKeyWithPlanLimitCheck,
  createProjectWithPlanLimitCheck,
  getMonthlyIngestUsed,
  loadPlanContextForProject,
} from "../lib/plan-enforcement.js";
import { hashApiKeySecret } from "../lib/api-key-auth.js";
import { getSessionUser, requireSessionUser } from "../lib/auth-session.js";
import {
  canCreateApiKey,
  canCreateProject,
  canManageMembers,
  canResolveErrors,
  canRevokeApiKey,
  getMembershipRoleForOrganization,
  getMembershipRoleForProject,
} from "../lib/org-permissions.js";
import { headerFirst } from "../lib/http-headers.js";
import {
  publicDashboardReadsEnabled,
  resolveReadProjectId,
  resolveReadProjectIdWithSession,
  tryResolveReadProjectId,
} from "../lib/read-project-request.js";

const DEFAULT_ORG_ID =
  process.env.TELEMETRY_ORGANIZATION_ID?.trim() ||
  "a0000000-0000-4000-8000-000000000001";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INVITE_DAYS = 7;

function readOrgIdHeader(request: FastifyRequest): string | undefined {
  const raw = headerFirst(request, "x-organization-id");
  if (!raw || !UUID_RE.test(raw)) return undefined;
  return raw.toLowerCase();
}

function slugifyProjectName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "project";
}

const MAX_SLUG_LEN = 64;
/** Max stem length so `${stem}-${n}` fits in MAX_SLUG_LEN without truncating the counter into identical slugs. */
const SLUG_STEM_MAX = 52;

/**
 * Allocate a unique `slug` per org. Long `base` values are truncated to `SLUG_STEM_MAX` before appending
 * `-1`, `-2`, … so `.slice(0, 64)` cannot repeat the same string forever (see slug collision bug).
 */
async function ensureUniqueSlug(orgId: string, base: string): Promise<string> {
  const stem =
    (base.length <= SLUG_STEM_MAX ? base : base.slice(0, SLUG_STEM_MAX)).replace(
      /-+$/g,
    "") || "project";
  let n = 0;
  while (n < 1_000_000) {
    const slug =
      n === 0 ? stem : `${stem}-${n}`.slice(0, MAX_SLUG_LEN);
    // `@@unique([organization_id, slug])` applies to soft-deleted rows too — must not reuse.
    const clash = await prisma.project.findFirst({
      where: { organization_id: orgId, slug },
      select: { id: true },
    });
    if (!clash) return slug;
    n += 1;
  }
  for (let attempt = 0; attempt < 32; attempt++) {
    const suffix = randomBytes(5).toString("hex");
    const slug = `${stem}-${suffix}`.slice(0, MAX_SLUG_LEN);
    const clash = await prisma.project.findFirst({
      where: { organization_id: orgId, slug },
      select: { id: true },
    });
    if (!clash) return slug;
  }
  throw new Error("Could not allocate unique project slug");
}

function parseOrgRole(raw: unknown): OrgRole | null {
  if (raw === "OWNER" || raw === "EDITOR" || raw === "VIEWER") return raw;
  return null;
}

function dashboardInviteBaseUrl(): string {
  const raw = process.env.TELEMETRY_DASHBOARD_ORIGIN?.trim();
  return raw ? raw.replace(/\/$/, "") : "";
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
    const rows = await prisma.organizationMembership.findMany({
      where: { user_id: session.userId },
      select: {
        organization: { select: { id: true, name: true } },
      },
      orderBy: { created_at: "asc" },
    });
    return reply.send({
      organizations: rows.map((r) => ({
        id: r.organization.id,
        name: r.organization.name,
      })),
    });
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

  app.get("/meta/projects", async (request, reply) => {
    const session = await getSessionUser(request);
    const headerOrg = readOrgIdHeader(request);

    if (session) {
      const orgRows = await prisma.organizationMembership.findMany({
        where: { user_id: session.userId },
        select: { organization_id: true },
      });
      const orgIds = [...new Set(orgRows.map((r) => r.organization_id))];
      if (orgIds.length === 0) {
        return reply.send({ projects: [] });
      }

      let filterIds = orgIds;
      if (headerOrg) {
        if (!orgIds.includes(headerOrg)) {
          return reply.status(403).send({ error: "Not a member of this organization" });
        }
        filterIds = [headerOrg];
      }

      const projects = await prisma.project.findMany({
        where: { organization_id: { in: filterIds }, deleted_at: null },
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
    }

    if (headerOrg || !publicDashboardReadsEnabled()) {
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
    const slug = await ensureUniqueSlug(orgId, slugBase);

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

  app.get("/meta/invites/preview", async (request, reply) => {
    const q = request.query as { token?: string };
    const token = typeof q.token === "string" ? q.token.trim() : "";
    if (!token) {
      return reply.send({ valid: false });
    }
    const invite = await prisma.organizationInvite.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    });
    if (!invite || invite.expires_at.getTime() <= Date.now()) {
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
            await tx.organizationMembership.create({
              data: {
                user_id: target.id,
                organization_id: orgId,
                role: newRole,
              },
            });
            return { kind: "added" as const };
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
        if (addExisting.kind === "already_member") {
          return reply.status(409).send({ error: "User is already a member" });
        }
        return reply.status(201).send({ status: "added" as const });
      }

      const { token } = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
        );
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
        return { token: row.token };
      });

      const base = dashboardInviteBaseUrl();
      const inviteUrl = base
        ? `${base}/register?invite=${encodeURIComponent(token)}`
        : `/register?invite=${encodeURIComponent(token)}`;

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
    const headerOrg = readOrgIdHeader(request);
    const projectId = await tryResolveReadProjectId(request);
    const projRole =
      projectId !== null
        ? await getMembershipRoleForProject(session.userId, projectId)
        : null;

    const orgRoleFromHeader = headerOrg
      ? await getMembershipRoleForOrganization(session.userId, headerOrg)
      : null;
    /** Org-scoped UI (sidebar org): prefer explicit org membership; if header is stale, fall back to project org. */
    const orgCapabilityRole = orgRoleFromHeader ?? projRole;

    if (projRole === null && orgCapabilityRole === null) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    let usageQuota: {
      planTier: string;
      monthlyIngestUsed: number;
      monthlyIngestLimit: number;
      /** Rounded (used/limit)*100; not capped so it stays consistent with used/limit. */
      percentUsed: number;
      /** True when usage is at or above the monthly cap (ingest is rejected for new units). */
      quotaExceeded: boolean;
      nearQuota: boolean;
    } | null = null;
    if (projectId !== null) {
      const ctx = await loadPlanContextForProject(prisma, projectId);
      if (ctx) {
        const used = await getMonthlyIngestUsed(prisma, projectId);
        const limit = ctx.limits.monthlyIngestUnits;
        const ratio = limit > 0 ? used / limit : 0;
        const quotaExceeded = limit > 0 && used >= limit;
        usageQuota = {
          planTier: ctx.planTier,
          monthlyIngestUsed: used,
          monthlyIngestLimit: limit,
          percentUsed: Math.round(ratio * 100),
          quotaExceeded,
          nearQuota: ratio >= 0.9,
        };
      }
    }

    return reply.send({
      projectId: projectId ?? "",
      role: projRole ?? orgCapabilityRole ?? OrgRole.VIEWER,
      canResolveErrors: canResolveErrors(projRole),
      canCreateApiKey: canCreateApiKey(projRole),
      canRevokeApiKey: canRevokeApiKey(projRole),
      canCreateProject: canCreateProject(orgCapabilityRole),
      canManageMembers: canManageMembers(orgCapabilityRole),
      usageQuota,
    });
  });

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
        user: { select: { id: true, email: true, display_name: true } },
      },
      orderBy: { created_at: "asc" },
    });
    return reply.send({
      organizationId: orgId,
      members: rows.map((r) => ({
        userId: r.user.id,
        email: r.user.email,
        displayName: r.user.display_name,
        role: r.role,
        joinedAt: r.created_at.toISOString(),
      })),
    });
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
    const body = (request.body ?? {}) as { name?: string; allowedApp?: string };
    const name =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim().slice(0, 120)
        : null;
    let allowedApp: string | null = null;
    if (typeof body.allowedApp === "string" && body.allowedApp.trim() !== "") {
      allowedApp = body.allowedApp.trim().slice(0, 64);
    }

    const publicId = randomBytes(16).toString("hex");
    const secret = randomBytes(32).toString("hex");
    const secretHash = hashApiKeySecret(publicId, secret);
    const fullKey = `tt_live_${publicId}_${secret}`;

    const keyCreated = await createApiKeyWithPlanLimitCheck(prisma, projectId, {
      public_id: publicId,
      secret_hash: secretHash,
      name,
      allowed_app: allowedApp,
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
      key: fullKey,
      publicId,
      name,
      allowedApp,
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
}
