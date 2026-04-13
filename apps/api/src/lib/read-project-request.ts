import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { getSessionUser, type SessionUser } from "./auth-session.js";
import { headerFirst } from "./http-headers.js";
import { readProjectIdFromEnv } from "./project-scope.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveProjectIdOrFallback(
  rawProjectId: string | undefined,
  fallbackProjectId: string
): Promise<string> {
  if (!rawProjectId || !UUID_RE.test(rawProjectId)) {
    return fallbackProjectId;
  }
  const project = await prisma.project.findFirst({
    where: { id: rawProjectId, deleted_at: null },
    select: { id: true },
  });
  return project?.id ?? fallbackProjectId;
}

async function sessionCanReadProject(
  userId: string,
  projectId: string
): Promise<boolean | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { organization_id: true },
  });
  if (!project) {
    // Keep legacy behavior for non-existent fallback ids.
    return null;
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      user_id: userId,
      organization_id: project.organization_id,
    },
    select: { id: true },
  });
  return Boolean(membership);
}

/**
 * Dashboard sends `X-Project-Id` to scope reads. Validates UUID and that the project exists
 * and is not soft-deleted; otherwise falls back to `TELEMETRY_PROJECT_ID`.
 * If a session is present, the user must be a member of the resolved project’s organization.
 * Without a session, legacy behavior remains (resolved project id or env fallback).
 * Returns `null` after sending 403 when the session user may not access the project.
 */
export async function resolveReadProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const fallback = readProjectIdFromEnv();
  const raw = headerFirst(request, "x-project-id");
  const projectId = await resolveProjectIdOrFallback(raw, fallback);

  const session = await getSessionUser(request);
  if (session) {
    const canRead = await sessionCanReadProject(session.userId, projectId);
    if (canRead === false) {
      await reply.status(403).send({ error: "Not a member of this project" });
      return null;
    }
  }

  return projectId;
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
  const projectId = await resolveProjectIdOrFallback(raw, fallback);
  const canRead = await sessionCanReadProject(session.userId, projectId);
  if (canRead === false) {
    await reply.status(403).send({ error: "Not a member of this project" });
    return null;
  }
  return projectId;
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
  const projectId = await resolveProjectIdOrFallback(raw, fallback);

  const session = await getSessionUser(request);
  if (session) {
    const canRead = await sessionCanReadProject(session.userId, projectId);
    if (canRead === false) {
      return null;
    }
  }

  return projectId;
}
