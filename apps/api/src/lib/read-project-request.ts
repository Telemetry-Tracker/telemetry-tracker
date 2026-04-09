import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { getSessionUser, type SessionUser } from "./auth-session.js";
import { headerFirst } from "./http-headers.js";
import { readProjectIdFromEnv } from "./project-scope.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findLiveProject(projectId: string): Promise<{
  id: string;
  organization_id: string;
} | null> {
  return prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { id: true, organization_id: true },
  });
}

async function resolveRequestedOrFallbackProject(
  request: FastifyRequest,
  fallbackProjectId: string
): Promise<{ id: string; organization_id: string } | null> {
  const raw = headerFirst(request, "x-project-id");
  if (raw && UUID_RE.test(raw)) {
    const requested = await findLiveProject(raw);
    if (requested) {
      return requested;
    }
  }
  return findLiveProject(fallbackProjectId);
}

async function hasProjectAccess(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const m = await prisma.organizationMembership.findFirst({
    where: {
      user_id: userId,
      organization_id: organizationId,
    },
    select: { id: true },
  });
  return Boolean(m);
}

/**
 * Dashboard sends `X-Project-Id` to scope reads. Validates UUID and that the project exists
 * and is not soft-deleted. If a session is present, the user must be a member of the project’s
 * organization. Without a session, legacy behavior: any existing project id (or env fallback).
 * Returns `null` after sending 403 when the session user may not access the project.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const project = await resolveRequestedOrFallbackProject(request, fallback);
  if (!project) {
    return fallback;
  }

  const session = await getSessionUser(request);
  if (session) {
    const allowed = await hasProjectAccess(session.userId, project.organization_id);
    if (!allowed) {
      await reply.status(403).send({ error: "Not a member of this project" });
      return null;
    }
    return project.id;
  }

  return project.id;
}

/**
 * Same as {@link resolveReadProjectId} for an authenticated caller, but uses a pre-loaded
 * {@link SessionUser} so handlers can require the session once and avoid a second session lookup.
 */
export async function resolveReadProjectIdWithSession(
  request: FastifyRequest,
  reply: FastifyReply,
  session: SessionUser
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const project = await resolveRequestedOrFallbackProject(request, fallback);
  if (!project) {
    return fallback;
  }

  const allowed = await hasProjectAccess(session.userId, project.organization_id);
  if (!allowed) {
    await reply.status(403).send({ error: "Not a member of this project" });
    return null;
  }
  return project.id;
}

/**
 * Like {@link resolveReadProjectId} but never sends a reply. When a session exists and the user is
 * not a member of the project’s organization, returns `null` instead of 403 (for aggregating
 * session context with org-scoped permissions).
 */
export async function tryResolveReadProjectId(
  request: FastifyRequest
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const project = await resolveRequestedOrFallbackProject(request, fallback);
  if (!project) {
    return fallback;
  }

  const session = await getSessionUser(request);
  if (session) {
    const allowed = await hasProjectAccess(session.userId, project.organization_id);
    if (!allowed) {
      return null;
    }
    return project.id;
  }

  return project.id;
}
