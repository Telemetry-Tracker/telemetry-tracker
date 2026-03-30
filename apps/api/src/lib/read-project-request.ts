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
    return fallback;
  }

  const project = await prisma.project.findFirst({
    where: { id: raw, deleted_at: null },
    select: { id: true, organization_id: true },
  });
  if (!project) {
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

/**
 * Resolve project id for write-sensitive operations.
 * Requires a valid session and organization membership for the selected project.
 */
export async function resolveMemberProjectId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const session = await getSessionUser(request);
  if (!session) {
    await reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  const fallback = readProjectIdFromEnv();
  const raw = headerFirst(request, "x-project-id");

  let project: { id: string; organization_id: string } | null = null;
  if (raw && UUID_RE.test(raw)) {
    project = await prisma.project.findFirst({
      where: { id: raw, deleted_at: null },
      select: { id: true, organization_id: true },
    });
  }
  if (!project) {
    project = await prisma.project.findFirst({
      where: { id: fallback, deleted_at: null },
      select: { id: true, organization_id: true },
    });
  }
  if (!project) {
    await reply.status(404).send({ error: "Project not found" });
    return null;
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: {
      user_id: session.userId,
      organization_id: project.organization_id,
    },
    select: { id: true },
  });
  if (!membership) {
    await reply.status(403).send({ error: "Not a member of this project" });
    return null;
  }

  return project.id;
}
