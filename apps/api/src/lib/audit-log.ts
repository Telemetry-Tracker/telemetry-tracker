import type { PrismaClient } from "@prisma/client";

/** Stable action identifiers for the settings / security MVP audit log. */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN: "auth.login",
  AUTH_PASSWORD_CHANGE: "auth.password_change",
  AUTH_SESSION_REVOKE: "auth.session.revoke",
  AUTH_SESSIONS_REVOKE_OTHERS: "auth.sessions.revoke_others",
  PROFILE_UPDATE: "profile.update",
  PROFILE_AVATAR_UPLOAD: "profile.avatar.upload",
  PROFILE_AVATAR_REMOVE: "profile.avatar.remove",
  /** Project PII scrub settings changed (deny-keys / session email flag). */
  PROJECT_PII_SCRUB_UPDATE: "project.pii_scrub.update",
  /** Project display name and/or slug changed. */
  PROJECT_UPDATE: "project.update",
  /** Organization (workspace) display name changed. */
  ORGANIZATION_UPDATE: "organization.update",
  /** Founder/admin resolved OrganizationReferral.needs_attention as VALID. */
  AFFILIATE_NEEDS_ATTENTION_RESOLVE: "affiliate.needs_attention.resolve",
  AFFILIATE_CREATED: "affiliate.created",
  AFFILIATE_UPDATED: "affiliate.updated",
  AFFILIATE_PAYOUT_MARKED_PAID: "affiliate.payout.marked_paid",
  AFFILIATE_DISPUTE_CREATED: "affiliate.dispute.created",
  /** Refund/dispute arrived for a referred org but no commission row matched. */
  AFFILIATE_COMMISSION_NOT_FOUND: "affiliate.commission.not_found",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const DEFAULT_AUDIT_LOG_LIMIT = 25;
export const MAX_AUDIT_LOG_LIMIT = 100;

export type AuditLogEventRow = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  target: string;
};

export type ParsedAuditLogQuery = {
  limit: number;
  cursor: { createdAt: Date; id: string } | null;
};

export function parseAuditLogQuery(raw: {
  limit?: unknown;
  cursor?: unknown;
}): ParsedAuditLogQuery | { error: string } {
  let limit = DEFAULT_AUDIT_LOG_LIMIT;
  if (raw.limit !== undefined) {
    const n = typeof raw.limit === "string" ? Number.parseInt(raw.limit, 10) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > MAX_AUDIT_LOG_LIMIT) {
      return { error: `limit must be between 1 and ${MAX_AUDIT_LOG_LIMIT}` };
    }
    limit = n;
  }

  const cursorRaw = typeof raw.cursor === "string" ? raw.cursor.trim() : "";
  if (!cursorRaw) {
    return { limit, cursor: null };
  }

  const sep = cursorRaw.lastIndexOf("_");
  if (sep <= 0 || sep >= cursorRaw.length - 1) {
    return { error: "Invalid cursor" };
  }
  const createdAtMs = Number.parseInt(cursorRaw.slice(0, sep), 10);
  const id = cursorRaw.slice(sep + 1);
  if (!Number.isFinite(createdAtMs) || !id) {
    return { error: "Invalid cursor" };
  }
  const createdAt = new Date(createdAtMs);
  if (Number.isNaN(createdAt.getTime())) {
    return { error: "Invalid cursor" };
  }

  return { limit, cursor: { createdAt, id } };
}

export function encodeAuditLogCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}_${id}`;
}

/**
 * Record the same audit event for every organization the actor belongs to.
 * Failures are swallowed so auth/profile flows are not blocked.
 */
export async function recordUserAuditEvents(
  db: PrismaClient,
  actorUserId: string,
  action: AuditAction,
  target: string
): Promise<void> {
  const trimmedTarget = target.trim().slice(0, 512);
  if (!trimmedTarget) return;

  try {
    const [memberships, actor] = await Promise.all([
      db.organizationMembership.findMany({
        where: { user_id: actorUserId, organization: { deleted_at: null } },
        select: { organization_id: true },
      }),
      db.user.findUnique({
        where: { id: actorUserId },
        select: { email: true },
      }),
    ]);
    if (!actor || memberships.length === 0) return;

    await db.organizationAuditEvent.createMany({
      data: memberships.map((m) => ({
        organization_id: m.organization_id,
        actor_user_id: actorUserId,
        actor_email: actor.email,
        action,
        target: trimmedTarget,
      })),
    });
  } catch {
    // Audit logging must not break primary flows.
  }
}

/**
 * Record an audit event for a single organization (project/settings changes).
 * Failures are swallowed so primary flows are not blocked.
 */
export async function recordOrganizationAuditEvent(
  db: PrismaClient,
  organizationId: string,
  actorUserId: string,
  action: AuditAction,
  target: string
): Promise<void> {
  const trimmedTarget = target.trim().slice(0, 512);
  if (!trimmedTarget || !organizationId) return;

  try {
    const actor = await db.user.findUnique({
      where: { id: actorUserId },
      select: { email: true },
    });
    if (!actor) return;

    await db.organizationAuditEvent.create({
      data: {
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: actor.email,
        action,
        target: trimmedTarget,
      },
    });
  } catch {
    // Audit logging must not break primary flows.
  }
}

export async function listOrganizationAuditEvents(
  db: PrismaClient,
  organizationId: string,
  query: ParsedAuditLogQuery
): Promise<{ events: AuditLogEventRow[]; nextCursor: string | null }> {
  const where = query.cursor
    ? {
        organization_id: organizationId,
        OR: [
          { created_at: { lt: query.cursor.createdAt } },
          {
            created_at: query.cursor.createdAt,
            id: { lt: query.cursor.id },
          },
        ],
      }
    : { organization_id: organizationId };

  const rows = await db.organizationAuditEvent.findMany({
    where,
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: {
      id: true,
      created_at: true,
      action: true,
      target: true,
      actor_user_id: true,
      actor_email: true,
    },
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    events: page.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      action: row.action,
      target: row.target,
    })),
    nextCursor:
      hasMore && last
        ? encodeAuditLogCursor(last.created_at, last.id)
        : null,
  };
}
