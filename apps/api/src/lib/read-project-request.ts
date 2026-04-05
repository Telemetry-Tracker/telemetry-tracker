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
 * and is not soft-deleted. If a session is present, the user must be a member of the project’s
 * organization. If a session is present, missing/invalid/unavailable project headers are denied
 * instead of falling back to the legacy default project.
 * Without a session, legacy behavior remains: any existing project id (or env fallback).
 * Returns `null` after sending 403 when the request may not access the resolved project.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    const session = await getSessionUser(request);
    if (session) {
      await reply.status(403).send({ error: "Project access denied" });
      return null;
    }
    return fallback;
  }

  const project = await prisma.project.findFirst({
    where: { id: raw, deleted_at: null },
    select: { id: true, organization_id: true },
  });
  if (!project) {
    const session = await getSessionUser(request);
    if (session) {
      await reply.status(403).send({ error: "Project access denied" });
      return null;
    }
    return fallback;
  }

  const session = await getSessionUser(request);
  if (session) {
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

  return project.id;
}
