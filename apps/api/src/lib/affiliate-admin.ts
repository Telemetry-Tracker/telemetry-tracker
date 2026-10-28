/**
 * Founder/admin allowlist for affiliate review actions.
 * AFFILIATE_ADMIN_EMAILS is a comma-separated list; comparison is case-insensitive trim.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { isAffiliateFeatureEnabled } from "./affiliates-feature-flag.js";
import { requireSessionUser } from "./auth-session.js";

export function parseAffiliateAdminEmails(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return (env.AFFILIATE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAffiliateAdminEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parseAffiliateAdminEmails(env).includes(normalized);
}

export type AffiliateAdminActor = { userId: string; email: string };

/**
 * Session user whose email is on AFFILIATE_ADMIN_EMAILS.
 * 404 when the affiliate flag is off; 401 without session; 403 if not allowlisted.
 */
export async function requireAffiliateAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AffiliateAdminActor | null> {
  if (!isAffiliateFeatureEnabled()) {
    await reply.status(404).send({ error: "Not found" });
    return null;
  }
  const session = await requireSessionUser(request, reply);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true },
  });
  if (!user || !isAffiliateAdminEmail(user.email)) {
    await reply.status(403).send({ error: "Forbidden" });
    return null;
  }
  return { userId: session.userId, email: user.email };
}
