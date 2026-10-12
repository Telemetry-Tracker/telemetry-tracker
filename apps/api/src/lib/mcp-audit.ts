import type { Prisma } from "@prisma/client";
import type { AuditAction } from "./audit-log.js";
/** Token mutations and their audit event commit together; an audit failure fails closed. */
export async function recordMcpAudit(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, action: AuditAction, tokenId: string) {
  const actor = await tx.user.findUniqueOrThrow({ where: { id: actorUserId }, select: { email: true } });
  await tx.organizationAuditEvent.create({ data: { organization_id: organizationId, actor_user_id: actorUserId, actor_email: actor.email, action, target: `read-token:${tokenId}` } });
}
