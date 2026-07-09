import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { verifyIngestApiKey } from "./api-key-auth.js";
import { getSessionUser, requireSessionUser } from "./auth-session.js";
import { headerFirst } from "./http-headers.js";
import { canCreateApiKey, getMembershipRoleForProject } from "./org-permissions.js";
import { normalizeMapAppLabel } from "./source-map-artifact.js";
import { resolveReadProjectIdWithSession } from "./read-project-request.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SOURCE_MAP_APP_RESTRICT_MSG =
  "This API key is restricted to a specific app label; send a matching `app` field.";

export type SourceMapUploadAuth = {
  projectId: string;
  /** Set when authenticated via API key with an app restriction. */
  apiKeyAllowedApp: string | null;
};

/**
 * Authorize `POST /api/project/source-maps` via dashboard session (EDITOR+) or project API key.
 * API key callers must send `X-Project-Id` matching the key's project.
 */
export async function resolveSourceMapUploadAuth(
  prisma: PrismaClient,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<SourceMapUploadAuth | null> {
  const session = await getSessionUser(request);
  if (session) {
    const active = await requireSessionUser(request, reply);
    if (!active) return null;
    const projectId = await resolveReadProjectIdWithSession(request, reply, active);
    if (projectId === null) return null;
    const projRole = await getMembershipRoleForProject(active.userId, projectId);
    if (!canCreateApiKey(projRole)) {
      await reply.status(403).send({ error: "Forbidden" });
      return null;
    }
    return { projectId, apiKeyAllowedApp: null };
  }

  const verified = await verifyIngestApiKey(prisma, request);
  if (!verified) {
    await reply.status(401).send({
      error:
        "Missing or invalid API key. Send Authorization: Bearer tt_live_<publicId>_<secret> or X-API-Key with the same value.",
    });
    return null;
  }

  const rawProjectId = headerFirst(request, "x-project-id");
  if (!rawProjectId || !UUID_RE.test(rawProjectId)) {
    await reply.status(400).send({ error: "X-Project-Id header is required" });
    return null;
  }
  if (rawProjectId.toLowerCase() !== verified.projectId.toLowerCase()) {
    await reply.status(403).send({ error: "API key does not belong to this project" });
    return null;
  }

  return {
    projectId: verified.projectId,
    apiKeyAllowedApp: verified.allowedApp,
  };
}

/** Enforce per-key app restriction on source map uploads (mirrors ingest behavior). */
export function assertSourceMapAppAllowed(
  auth: SourceMapUploadAuth,
  app: string,
  reply: FastifyReply
): boolean {
  if (auth.apiKeyAllowedApp == null) return true;
  if (normalizeMapAppLabel(app) !== normalizeMapAppLabel(auth.apiKeyAllowedApp)) {
    void reply.status(403).send({ error: SOURCE_MAP_APP_RESTRICT_MSG });
    return false;
  }
  return true;
}
