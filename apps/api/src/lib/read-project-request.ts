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
 * and is not soft-deleted.
 *
 * - If auth is enabled, a valid session is required.
 * - If a session is present, the user must be a member of the resolved project's organization.
 * - In explicit public-dashboard mode, unauthenticated requests are allowed but always scoped
 *   to the configured fallback project (never arbitrary `X-Project-Id` values).
 *
 * Returns `null` after sending 401/403 when unauthorized.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const session = await getSessionUser(request);

  const publicDashboard =
    process.env.TELEMETRY_PUBLIC_DASHBOARD === "true" ||
    process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD === "true";

  if (!session && !publicDashboard) {
    await reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  const raw = headerFirst(request, "x-project-id");
  const requestedProjectId = raw && UUID_RE.test(raw) ? raw : fallback;
  let project = await prisma.project.findFirst({
    where: { id: requestedProjectId, deleted_at: null },
    select: { id: true, organization_id: true },
  });

  // If requested project does not exist, fall back to the configured default project id.
  if (!project && requestedProjectId !== fallback) {
    project = await prisma.project.findFirst({
      where: { id: fallback, deleted_at: null },
      select: { id: true, organization_id: true },
    });
  }

  if (session) {
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

  // Public unauthenticated reads are always constrained to the fallback project.
  return fallback;
}
