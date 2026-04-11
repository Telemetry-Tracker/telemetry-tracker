import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { getSessionUser, type SessionUser } from "./auth-session.js";
import { headerFirst } from "./http-headers.js";
import { readProjectIdFromEnv } from "./project-scope.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProjectScopeRow = { id: string; organization_id: string };

async function findActiveProject(id: string): Promise<ProjectScopeRow | null> {
  return prisma.project.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, organization_id: true },
  });
}

async function isMemberOfProjectOrg(userId: string, project: ProjectScopeRow): Promise<boolean> {
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      user_id: userId,
      organization_id: project.organization_id,
    },
    select: { user_id: true },
  });
  return membership !== null;
}

async function resolveFallbackProjectForSession(
  fallbackProjectId: string,
  sessionUserId: string,
  reply?: FastifyReply
): Promise<string | null> {
  if (!UUID_RE.test(fallbackProjectId)) {
    // Preserve legacy behavior when fallback env var is malformed.
    return fallbackProjectId;
  }
  const fallbackProject = await findActiveProject(fallbackProjectId);
  if (!fallbackProject) {
    // Preserve legacy behavior when fallback id points to a missing/deleted project.
    return fallbackProjectId;
  }
  const allowed = await isMemberOfProjectOrg(sessionUserId, fallbackProject);
  if (!allowed) {
    if (reply) {
      await reply.status(403).send({ error: "Not a member of this project" });
    }
    return null;
  }
  return fallbackProject.id;
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
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    const session = await getSessionUser(request);
    if (!session) return fallback;
    return resolveFallbackProjectForSession(fallback, session.userId, reply);
  }

  const project = await findActiveProject(raw);
  if (!project) {
    const session = await getSessionUser(request);
    if (!session) return fallback;
    return resolveFallbackProjectForSession(fallback, session.userId, reply);
  }

  const session = await getSessionUser(request);
  if (session) {
    const allowed = await isMemberOfProjectOrg(session.userId, project);
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
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    return resolveFallbackProjectForSession(fallback, session.userId, reply);
  }

  const project = await findActiveProject(raw);
  if (!project) {
    return resolveFallbackProjectForSession(fallback, session.userId, reply);
  }

  const allowed = await isMemberOfProjectOrg(session.userId, project);
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
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    const session = await getSessionUser(request);
    if (!session) return fallback;
    return resolveFallbackProjectForSession(fallback, session.userId);
  }

  const project = await findActiveProject(raw);
  if (!project) {
    const session = await getSessionUser(request);
    if (!session) return fallback;
    return resolveFallbackProjectForSession(fallback, session.userId);
  }

  const session = await getSessionUser(request);
  if (session) {
    const allowed = await isMemberOfProjectOrg(session.userId, project);
    if (!allowed) {
      return null;
    }
    return project.id;
  }

  return project.id;
}
