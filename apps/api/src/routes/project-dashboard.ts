import { randomBytes } from "node:crypto";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { prisma } from "../lib/db.js";
import { hashApiKeySecret } from "../lib/api-key-auth.js";
import { getSessionUser } from "../lib/auth-session.js";
import { resolveReadProjectId } from "../lib/read-project-request.js";

const DEFAULT_ORG_ID =
  process.env.TELEMETRY_ORGANIZATION_ID?.trim() ||
  "a0000000-0000-4000-8000-000000000001";

/**
 * Dashboard routes: project list, org members, API key lifecycle.
 */
export async function projectDashboardRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  async function requireSessionUser(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const session = await getSessionUser(request);
    if (!session) {
      await reply.status(401).send({ error: "Unauthorized" });
      return null;
    }
    return session;
  }

  app.get("/meta/projects", async (request, reply) => {
    const session = await getSessionUser(request);
    if (session) {
      const orgRows = await prisma.organizationMembership.findMany({
        where: { user_id: session.userId },
        select: { organization_id: true },
      });
      const orgIds = [...new Set(orgRows.map((r) => r.organization_id))];
      if (orgIds.length === 0) {
        return reply.send({ projects: [] });
      }
      const projects = await prisma.project.findMany({
        where: { organization_id: { in: orgIds }, deleted_at: null },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      });
      return reply.send({ projects });
    }
    const projects = await prisma.project.findMany({
      where: { organization_id: DEFAULT_ORG_ID, deleted_at: null },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ projects });
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
    if (!(await requireSessionUser(request, reply))) return;
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const keys = await prisma.apiKey.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        public_id: true,
        name: true,
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
        createdAt: k.created_at.toISOString(),
        lastUsedAt: k.last_used_at?.toISOString() ?? null,
        revokedAt: k.revoked_at?.toISOString() ?? null,
        expiresAt: k.expires_at?.toISOString() ?? null,
      })),
    });
  });

  app.post("/project/api-keys", async (request, reply) => {
    if (!(await requireSessionUser(request, reply))) return;
    const projectId = await resolveReadProjectId(request, reply);
    if (projectId === null) return;
    const body = (request.body ?? {}) as { name?: string };
    const name =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim().slice(0, 120)
        : null;

    const publicId = randomBytes(16).toString("hex");
    const secret = randomBytes(32).toString("hex");
    const secretHash = hashApiKeySecret(publicId, secret);
    const fullKey = `tt_live_${publicId}_${secret}`;

    await prisma.apiKey.create({
      data: {
        project_id: projectId,
        public_id: publicId,
        secret_hash: secretHash,
        name,
      },
    });

    return reply.status(201).send({
      key: fullKey,
      publicId,
      name,
      message:
        "Copy this key now. It will not be shown again. Store it as a secret (e.g. environment variable).",
    });
  });

  app.post<{ Params: { publicId: string } }>(
    "/project/api-keys/:publicId/revoke",
    async (request, reply) => {
      if (!(await requireSessionUser(request, reply))) return;
      const projectId = await resolveReadProjectId(request, reply);
      if (projectId === null) return;
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
