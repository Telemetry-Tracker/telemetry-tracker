import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { getSessionUser, isPublicDashboardModeEnabled } from "./auth-session.js";
import { readProjectIdFromEnv } from "./project-scope.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerFirst(
  request: FastifyRequest,
  name: string
): string | undefined {
  const v = request.headers[name];
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  const t = typeof s === "string" ? s.trim() : "";
  return t || undefined;
}

/**
 * Dashboard sends `X-Project-Id` to scope reads. Validates UUID and that the project exists
 * and is not soft-deleted (fallbacks to `TELEMETRY_PROJECT_ID` when missing/invalid).
 * In private mode (default), a valid user session is required and the user must be a member
 * of the project's organization. In public mode, sessionless reads are allowed.
 * Returns `null` after sending 401/403 when access is denied.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const raw = headerFirst(request, "x-project-id");

  const requested = raw && UUID_RE.test(raw) ? raw : undefined;
  const project =
    (requested
      ? await prisma.project.findFirst({
          where: { id: requested, deleted_at: null },
          select: { id: true, organization_id: true },
        })
      : null) ??
    (await prisma.project.findFirst({
      where: { id: fallback, deleted_at: null },
      select: { id: true, organization_id: true },
    }));
  if (!project) {
    await reply.status(503).send({ error: "No active project configured" });
    return null;
  }

  if (isPublicDashboardModeEnabled()) {
    return project.id;
  }

  const session = await getSessionUser(request);
  if (!session) {
    await reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  const m = await prisma.organizationMembership.findFirst({
    where: {
      user_id: session.userId,
      organization_id: project.organization_id,
    },
    select: { id: true, organization_id: true },
  });
  if (!m) {
    await reply.status(403).send({ error: "Not a member of this project" });
    return null;
  }

  return project.id;
}
