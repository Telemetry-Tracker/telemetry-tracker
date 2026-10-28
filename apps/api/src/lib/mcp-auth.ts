import { recordMcpAudit } from "./mcp-audit.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";
import { AUDIT_ACTIONS } from "./audit-log.js";

export const READ_TOKEN_RE = /^tt_read_([a-f0-9]{32})_([a-f0-9]{64})$/;
export function hashReadToken(publicId: string, secret: string): string {
  return createHash("sha256").update(`${publicId}:${secret}`).digest("hex");
}
export function mintReadToken() {
  const publicId = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return { publicId, secretHash: hashReadToken(publicId, secret), token: `tt_read_${publicId}_${secret}` };
}
export function verifyReadTokenHash(value: string, hash: string): boolean {
  const parts = READ_TOKEN_RE.exec(value);
  if (!parts || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashReadToken(parts[1]!, parts[2]!), "hex"), Buffer.from(hash, "hex"));
}
export const mcpEnabled = () => process.env.TELEMETRY_MCP_ENABLED === "true";

export async function authenticateMcp(authorization: string | undefined) {
  const value = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const parts = READ_TOKEN_RE.exec(value);
  if (!parts) return null;
  const token = await prisma.mcpReadToken.findUnique({
    where: { public_id: parts[1] },
    include: { organization: { select: { deleted_at: true, plan_tier: true } } },
  });
  if (!token || !verifyReadTokenHash(value, token.secret_hash) || token.revoked_at) return null;
  if (token.expires_at <= new Date()) {
    // Log at first observation of expiry, once, with no credential in the target.
    await prisma.$transaction(async (tx) => {
      const claim = await tx.mcpReadToken.updateMany({ where: { id: token.id, expiry_logged_at: null }, data: { expiry_logged_at: new Date() } });
      if (claim.count) await recordMcpAudit(tx, token.organization_id, token.created_by_user_id, AUDIT_ACTIONS.MCP_TOKEN_EXPIRE, token.id);
    });
    return null;
  }
  if (token.organization.deleted_at) return null;
  const member = await prisma.organizationMembership.findUnique({
    where: { user_id_organization_id: { organization_id: token.organization_id, user_id: token.created_by_user_id } },
  });
  if (!member) return null;
  const projects = await prisma.project.findMany({
    where: { id: { in: token.project_ids }, organization_id: token.organization_id, deleted_at: null },
    select: { id: true, name: true, slug: true },
  });
  if (!projects.length) return null;
  return { token, projects };
}
export type McpAuth = NonNullable<Awaited<ReturnType<typeof authenticateMcp>>>;

export function mcpRateLimits(plan: string) {
  return plan === "FREE" ? { token: 30, org: 120 } : { token: 120, org: 600 };
}
/** Atomic database buckets work across processes/replicas; each key has a single fixed row. */
export async function consumeMcpRate(auth: McpAuth): Promise<boolean> {
  const limits = mcpRateLimits(auth.token.organization.plan_tier);
  return prisma.$transaction(async (tx) => {
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    let allowed = true;
    for (const [key, max] of [[`org:${auth.token.organization_id}`, limits.org], [`token:${auth.token.id}`, limits.token]] as const) {
      const rows = await tx.$queryRaw<{ count: number }[]>`
        INSERT INTO "McpRateBucket" ("key", "window_start", "count") VALUES (${key}, ${start}, 1)
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "McpRateBucket"."window_start" = ${start} THEN LEAST("McpRateBucket"."count" + 1, 1000000) ELSE 1 END,
          "window_start" = ${start}
        RETURNING "count"`;
      if (rows[0]!.count > max) allowed = false;
    }
    return allowed;
  });
}
