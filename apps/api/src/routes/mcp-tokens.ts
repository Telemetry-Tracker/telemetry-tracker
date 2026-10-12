import { recordMcpAudit } from "../lib/mcp-audit.js";
import type { FastifyInstance } from "fastify";
import { issueDashboardUrl, MCP_INSTRUCTIONS, untrustedText } from "../lib/mcp-output.js";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireSessionUser } from "../lib/auth-session.js";
import { resolveReadProjectIdWithSession } from "../lib/read-project-request.js";
import { canCreateApiKey, getMembershipRoleForOrganization } from "../lib/org-permissions.js";
import { mintReadToken, mcpEnabled } from "../lib/mcp-auth.js";
import { isIngestPiiScrubEnabled } from "../lib/ingest-pii-scrub.js";
import { AUDIT_ACTIONS } from "../lib/audit-log.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  projectIds: z.array(z.string().uuid()).min(1).max(25).optional(),
  expiryDays: z.number().int().min(1).max(365).default(90),
}).strict();
const publicSelect = {
  id: true, name: true, project_ids: true, created_at: true, expires_at: true,
  revoked_at: true, last_used_at: true, usage_count: true, last_tool: true,
} as const;

export async function mcpTokenRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!mcpEnabled() || !isIngestPiiScrubEnabled()) return reply.code(404).send({ error: "Agent access disabled" });
  });
  app.get<{ Params: { id: string } }>("/project/agent-summary/:id", async (req, reply) => {
    const session = await requireSessionUser(req, reply); if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(req, reply, session); if (!projectId) return;
    const group = await prisma.errorGroup.findFirst({ where: { id: req.params.id, project_id: projectId }, select: { id: true, message: true, top_stack: true, occurrences: true, first_seen: true, last_seen: true, resolved_at: true } });
    if (!group) return reply.code(404).send({ error: "Issue not found" });
    return { instructions: MCP_INSTRUCTIONS, issue_id: group.id, project_id: projectId, title: untrustedText(group.message), stack: untrustedText(group.top_stack, 4000), occurrences: group.occurrences, first_seen: group.first_seen, last_seen: group.last_seen, status: group.resolved_at ? "resolved" : "unresolved", dashboard_url: issueDashboardUrl(group.id) };
  });
  app.get("/project/agent-tokens", async (req, reply) => {
    const session = await requireSessionUser(req, reply); if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(req, reply, session); if (!projectId) return;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const role = await getMembershipRoleForOrganization(session.userId, project.organization_id);
    if (!canCreateApiKey(role)) return reply.code(403).send({ error: "Owner or editor required" });
    const [tokens, projects] = await Promise.all([
      prisma.mcpReadToken.findMany({ where: { organization_id: project.organization_id, ...(role === "OWNER" ? {} : { created_by_user_id: session.userId }) }, select: publicSelect, orderBy: { created_at: "desc" }, take: 100 }),
      prisma.project.findMany({ where: { organization_id: project.organization_id, deleted_at: null }, select: { id: true, name: true } }),
    ]);
    return { tokens, projects, defaultProjectId: projectId };
  });
  app.post("/project/agent-tokens", async (req, reply) => {
    const session = await requireSessionUser(req, reply); if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(req, reply, session); if (!projectId) return;
    const input = createSchema.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: "Invalid token name, project selection or expiry (1–365 days)" });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const role = await getMembershipRoleForOrganization(session.userId, project.organization_id);
    if (!canCreateApiKey(role)) return reply.code(403).send({ error: "Owner or editor required" });
    const ids = [...new Set(input.data.projectIds ?? [projectId])];
    const count = await prisma.project.count({ where: { id: { in: ids }, organization_id: project.organization_id, deleted_at: null } });
    if (count !== ids.length) return reply.code(403).send({ error: "Projects must belong to this organization" });
    const secret = mintReadToken();
    const row = await prisma.$transaction(async (tx) => {
      const token = await tx.mcpReadToken.create({ data: {
        name: input.data.name, public_id: secret.publicId, secret_hash: secret.secretHash,
        organization_id: project.organization_id, created_by_user_id: session.userId, project_ids: ids,
        expires_at: new Date(Date.now() + input.data.expiryDays * 86400_000),
      }, select: publicSelect });
      await recordMcpAudit(tx, project.organization_id, session.userId, AUDIT_ACTIONS.MCP_TOKEN_CREATE, token.id);
      return token;
    });
    return reply.code(201).send({ token: secret.token, metadata: row });
  });
  app.delete<{ Params: { id: string } }>("/project/agent-tokens/:id", async (req, reply) => {
    const session = await requireSessionUser(req, reply); if (!session) return;
    const projectId = await resolveReadProjectIdWithSession(req, reply, session); if (!projectId) return;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const role = await getMembershipRoleForOrganization(session.userId, project.organization_id);
    const token = await prisma.mcpReadToken.findFirst({ where: { id: req.params.id, organization_id: project.organization_id } });
    if (!token || (role !== "OWNER" && token.created_by_user_id !== session.userId)) return reply.code(403).send({ error: "Not permitted" });
    await prisma.$transaction(async (tx) => {
      const changed = await tx.mcpReadToken.updateMany({ where: { id: token.id, revoked_at: null }, data: { revoked_at: new Date() } });
      if (changed.count) await recordMcpAudit(tx, project.organization_id, session.userId, AUDIT_ACTIONS.MCP_TOKEN_REVOKE, token.id);
    });
    return { ok: true };
  });
}
