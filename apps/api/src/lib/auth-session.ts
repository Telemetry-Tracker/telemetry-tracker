import type { FastifyRequest } from "fastify";
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

/**
 * Legacy/public dashboard mode keeps read APIs open without user sessions.
 * Private mode (default) requires authenticated sessions for dashboard reads.
 */
export function isPublicDashboardModeEnabled(): boolean {
  return (
    process.env.TELEMETRY_PUBLIC_DASHBOARD === "true" ||
    process.env.NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD === "true"
  );
}

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
