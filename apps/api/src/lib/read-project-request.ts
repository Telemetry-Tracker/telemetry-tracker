import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { getSessionUser } from "./auth-session.js";
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
 * and is not soft-deleted. If a session is present, the user must be a member of the resolved
 * project's organization (including env fallback). Without a session, only env fallback is used.
 * Returns `null` after sending 403 when the session user may not access the project.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const raw = headerFirst(request, "x-project-id");
  const requestedProjectId = raw && UUID_RE.test(raw) ? raw : undefined;
  const session = await getSessionUser(request);

  // No session: preserve legacy public access to the env-scoped project only.
  if (!session) {
    return fallback;
  }

  const candidateProjectId = requestedProjectId ?? fallback;
  let project = await prisma.project.findFirst({
    where: { id: candidateProjectId, deleted_at: null },
    select: { id: true, organization_id: true },
  });
  if (!project && candidateProjectId !== fallback) {
    project = await prisma.project.findFirst({
      where: { id: fallback, deleted_at: null },
      select: { id: true, organization_id: true },
    });
  }
  if (!project) {
    return fallback;
  }

  const m = await prisma.organizationMembership.findFirst({
    where: {
      user_id: session.userId,
      organization_id: project.organization_id,
    },
  });
  if (!m) {
    await reply.status(403).send({ error: "Not a member of this project" });
    return null;
  }
  return project.id;
}
