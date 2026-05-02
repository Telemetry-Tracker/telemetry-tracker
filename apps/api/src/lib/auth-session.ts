import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerBearer(request: FastifyRequest): string | undefined {
  const v = request.headers.authorization;
  if (typeof v !== "string" || !v.startsWith("Bearer ")) return undefined;
  const t = v.slice(7).trim();
  return t || undefined;
}

function cookieSession(request: FastifyRequest): string | undefined {
  const raw = request.headers.cookie;
  if (!raw || typeof raw !== "string") return undefined;
  const parts = raw.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const name = p.slice(0, idx).trim();
    if (name !== "telemetry_session") continue;
    let val = p.slice(idx + 1).trim();
    try {
      val = decodeURIComponent(val);
    } catch {
      /* ignore */
    }
    return val || undefined;
  }
  return undefined;
}

export function getSessionTokenFromRequest(request: FastifyRequest): string | undefined {
  return headerBearer(request) ?? cookieSession(request);
}

export type SessionUser = { userId: string };

export async function getSessionUser(
  request: FastifyRequest
): Promise<SessionUser | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token || !UUID_RE.test(token)) return null;
  const row = await prisma.userSession.findFirst({
    where: { id: token, expires_at: { gt: new Date() } },
    select: { user_id: true },
  });
  return row ? { userId: row.user_id } : null;
}

/**
 * Require a valid dashboard session. Sends 401 and returns null if missing.
 */
export async function requireSessionUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<SessionUser | null> {
  const session = await getSessionUser(request);
  if (!session) {
    await reply.status(401).send({ error: "Authentication required" });
    return null;
  }
  return session;
}
