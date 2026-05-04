import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { getSessionUser, type SessionUser } from "./auth-session.js";
import { headerFirst } from "./http-headers.js";
import { readProjectIdFromEnv } from "./project-scope.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dashboard sends `X-Project-Id` to scope reads. Validates UUID and that the project exists
 * and is not soft-deleted. Authenticated users must be members of the project's organization.
 * Unauthenticated reads are only allowed when explicitly running the legacy public dashboard.
 * Returns `null` after sending 401/403 when the caller may not access the project.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const session = await getSessionUser(request);
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    return resolveFallbackProjectId(reply, session, true);
  }

  const project = await prisma.project.findFirst({
    where: { id: raw, deleted_at: null },
    select: { id: true, organization_id: true },
  });
  if (!project) {
    return resolveFallbackProjectId(reply, session, true);
  }

  if (!session) {
    if (publicDashboardReadsEnabled()) return project.id;
    await reply.status(401).send({ error: "Authentication required" });
    return null;
  }

  if (!(await isProjectMember(session, project.organization_id))) {
    await reply.status(403).send({ error: "Not a member of this project" });
    return null;
  }
  return project.id;
}

function publicDashboardReadsEnabled(): boolean {
  return (
    process.env.TELEMETRY_PUBLIC_DASHBOARD === "true" ||
    process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD === "true"
  );
}

async function isProjectMember(
  session: SessionUser,
  organizationId: string
): Promise<boolean> {
  const m = await prisma.organizationMembership.findFirst({
    where: {
      user_id: session.userId,
      organization_id: organizationId,
    },
    select: { id: true },
  });
  return Boolean(m);
}

async function resolveFallbackProjectId(
  reply: FastifyReply | null,
  session: SessionUser | null,
  sendUnauthorized: boolean
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const project = await prisma.project.findFirst({
    where: { id: fallback, deleted_at: null },
    select: { id: true, organization_id: true },
  });

  if (!session) {
    if (publicDashboardReadsEnabled()) return fallback;
    if (sendUnauthorized && reply) {
      await reply.status(401).send({ error: "Authentication required" });
    }
    return null;
  }

  if (!project) return fallback;
  if (!(await isProjectMember(session, project.organization_id))) {
    if (reply) {
      await reply.status(403).send({ error: "Not a member of this project" });
    }
    return null;
  }
  return fallback;
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
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    return resolveFallbackProjectId(reply, session, true);
  }

  const project = await prisma.project.findFirst({
    where: { id: raw, deleted_at: null },
    select: { id: true, organization_id: true },
  });
  if (!project) {
    return resolveFallbackProjectId(reply, session, true);
  }

  if (!(await isProjectMember(session, project.organization_id))) {
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
  const session = await getSessionUser(request);
  const raw = headerFirst(request, "x-project-id");
  if (!raw || !UUID_RE.test(raw)) {
    return resolveFallbackProjectId(null, session, false);
  }

  const project = await prisma.project.findFirst({
    where: { id: raw, deleted_at: null },
    select: { id: true, organization_id: true },
  });
  if (!project) {
    return resolveFallbackProjectId(null, session, false);
  }

  if (!session) {
    return publicDashboardReadsEnabled() ? project.id : null;
  }

  if (!(await isProjectMember(session, project.organization_id))) {
    return null;
  }

  return project.id;
}
