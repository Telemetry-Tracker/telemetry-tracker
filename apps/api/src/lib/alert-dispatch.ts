import { randomUUID } from "node:crypto";
import { type AlertRuleType, type PrismaClient } from "@prisma/client";
import type { DashboardNotificationItem } from "./dashboard-notifications.js";
import { notifyProjectMembersByEmail } from "./notification-email-dispatch.js";
import { enqueueAlertWebhookDeliveries } from "./alert-webhook-dispatch.js";

export type AlertFireDestinations = {
  /**
   * When false, skip email fan-out. Default true (legacy built-in alerts).
   */
  email?: boolean;
  /**
   * When set, only enqueue these ProjectWebhook ids (empty = no webhooks).
   * When omitted, enqueue all enabled project webhooks (legacy behavior).
   */
  webhookIds?: string[];
};

export type AlertFirePayload = {
  projectId: string;
  rule: AlertRuleType;
  dedupeKey: string;
  title: string;
  body: string;
  href: string | null;
  destinations?: AlertFireDestinations;
};

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}

/** Default in-app link when legacy rows have no stored href. */
export function alertEventHref(rule: AlertRuleType, stored: string | null): string | null {
  if (stored) return stored;
  switch (rule) {
    case "ERROR_SPIKE":
    case "ALERT_RULE":
      return "/dashboard/errors";
    case "QUOTA_NEAR":
    case "QUOTA_EXCEEDED":
      return "/dashboard/settings/billing";
    default:
      return "/dashboard/alerts";
  }
}

/** Record alert history and fan out to email + configured webhooks (deduped). */
export async function fireProjectAlert(
  prisma: PrismaClient,
  payload: AlertFirePayload
): Promise<boolean> {
  const alertEventId = randomUUID();
  const firedAt = new Date();
  try {
    // AlertEvent + PENDING webhook rows commit together so a failed enqueue
    // cannot leave a dedupe key that blocks later retries from re-enqueueing.
    await prisma.$transaction(async (tx) => {
      await tx.alertEvent.create({
        data: {
          id: alertEventId,
          project_id: payload.projectId,
          rule: payload.rule,
          title: payload.title,
          body: payload.body,
          href: payload.href,
          dedupe_key: payload.dedupeKey,
          fired_at: firedAt,
        },
      });
      await enqueueAlertWebhookDeliveries(tx, {
        projectId: payload.projectId,
        alertEventId,
        dedupeKey: payload.dedupeKey,
        webhookIds: payload.destinations?.webhookIds,
      });
    });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }

  const item: DashboardNotificationItem = {
    id: payload.dedupeKey,
    type: "alert",
    title: payload.title,
    body: payload.body,
    occurredAt: firedAt.toISOString(),
    href: payload.href,
  };

  const sendEmail = payload.destinations?.email !== false;
  if (sendEmail) {
    // The evaluator cron disconnects Prisma as soon as the sweep returns.
    // Email logging must finish first or createMany hits a dead engine.
    await notifyProjectMembersByEmail(prisma, payload.projectId, item, {
      rule: payload.rule,
    });
  }

  return true;
}

export async function listRecentAlertEvents(
  prisma: PrismaClient,
  projectId: string,
  limit = 25
) {
  return prisma.alertEvent.findMany({
    where: { project_id: projectId },
    orderBy: { fired_at: "desc" },
    take: limit,
    select: {
      id: true,
      rule: true,
      title: true,
      body: true,
      href: true,
      dedupe_key: true,
      fired_at: true,
    },
  });
}

const RECENT_ALERTS_IN_BELL_DAYS = 7;
const RECENT_ALERTS_IN_CENTER_DAYS = 30;

export type RecentAlertNotificationsOptions = {
  /** Notification Center uses a longer lookback and higher take. */
  mode?: "bell" | "center";
  projectName?: string | null;
};

export async function recentAlertNotifications(
  prisma: PrismaClient,
  projectId: string,
  options?: RecentAlertNotificationsOptions
): Promise<DashboardNotificationItem[]> {
  const mode = options?.mode ?? "bell";
  const days = mode === "center" ? RECENT_ALERTS_IN_CENTER_DAYS : RECENT_ALERTS_IN_BELL_DAYS;
  const take = mode === "center" ? 25 : 5;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.alertEvent.findMany({
    where: {
      project_id: projectId,
      fired_at: { gte: since },
    },
    orderBy: { fired_at: "desc" },
    take,
    select: {
      rule: true,
      title: true,
      body: true,
      href: true,
      dedupe_key: true,
      fired_at: true,
    },
  });

  return rows.map((row) => ({
    id: row.dedupe_key,
    type: "alert" as const,
    title: row.title,
    body: row.body,
    occurredAt: row.fired_at.toISOString(),
    href: alertEventHref(row.rule, row.href),
    projectId,
    projectName: options?.projectName ?? null,
  }));
}

/** Batch alert notifications across projects for the Notification Center. */
export async function recentAlertNotificationsForProjects(
  prisma: PrismaClient,
  projects: { id: string; name: string }[],
  options?: { mode?: "bell" | "center"; take?: number }
): Promise<DashboardNotificationItem[]> {
  if (projects.length === 0) return [];
  const mode = options?.mode ?? "center";
  const days = mode === "center" ? RECENT_ALERTS_IN_CENTER_DAYS : RECENT_ALERTS_IN_BELL_DAYS;
  const take = options?.take ?? (mode === "center" ? 100 : 5 * projects.length);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const byId = new Map(projects.map((p) => [p.id, p.name]));
  const rows = await prisma.alertEvent.findMany({
    where: {
      project_id: { in: projects.map((p) => p.id) },
      fired_at: { gte: since },
    },
    orderBy: { fired_at: "desc" },
    take,
    select: {
      project_id: true,
      rule: true,
      title: true,
      body: true,
      href: true,
      dedupe_key: true,
      fired_at: true,
    },
  });

  return rows.map((row) => ({
    id: row.dedupe_key,
    type: "alert" as const,
    title: row.title,
    body: row.body,
    occurredAt: row.fired_at.toISOString(),
    href: alertEventHref(row.rule, row.href),
    projectId: row.project_id,
    projectName: byId.get(row.project_id) ?? null,
  }));
}
