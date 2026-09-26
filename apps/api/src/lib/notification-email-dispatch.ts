import { randomUUID } from "node:crypto";
import {
  OrgRole,
  type AlertRuleType,
  type PrismaClient,
} from "@prisma/client";
import { sendTransactionalEmail } from "./email.js";
import { dashboardOriginOrNull } from "./dashboard-origin.js";
import type { DashboardNotificationItem } from "./dashboard-notifications.js";
import {
  parseNotificationPreferences,
  shouldSendEmailForItem,
  type NotificationPreferences,
} from "./notification-preferences.js";
import { quotaNotificationKey } from "./quota-notification-keys.js";
import {
  billingAlertNotificationContent,
  type BillingAlertVariant,
} from "./billing-alert.js";
import { billingNotificationKey } from "./billing-notification-keys.js";
import { teamInviteNotificationKey } from "./team-notification-keys.js";
import {
  alertEmailRolesToOrgRoles,
  parseProjectAlertSettings,
} from "./project-alert-settings.js";
import {
  buildNotificationEmailHtml,
  buildNotificationEmailSubject,
  inferNotificationEmailKind,
} from "./notification-email-template.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function logNotificationEmailFailure(
  error: unknown,
  context: { userId?: string; email?: string; notificationKey: string }
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      ok: false,
      job: "notification-email",
      message,
      ...context,
    })
  );
}

async function settleNotificationEmail(
  work: Promise<unknown>,
  context: { userId?: string; email?: string; notificationKey: string }
): Promise<void> {
  try {
    await work;
  } catch (error) {
    logNotificationEmailFailure(error, context);
  }
}

export async function sendNotificationEmailIfAllowed(
  prisma: PrismaClient,
  userId: string,
  email: string,
  item: DashboardNotificationItem,
  prefs: NotificationPreferences,
  options?: {
    rule?: AlertRuleType | null;
    projectName?: string | null;
  }
): Promise<boolean> {
  if (!shouldSendEmailForItem(prefs, item)) {
    return false;
  }

  const claimed = await prisma.notificationEmailLog.createMany({
    data: [
      {
        id: randomUUID(),
        user_id: userId,
        notification_key: item.id,
      },
    ],
    skipDuplicates: true,
  });
  if (claimed.count === 0) return false;

  const base = dashboardOriginOrNull();
  const kind = inferNotificationEmailKind(item, options?.rule);
  const result = await sendTransactionalEmail({
    to: email,
    subject: buildNotificationEmailSubject(item, kind),
    html: buildNotificationEmailHtml({
      item,
      kind,
      dashboardOrigin: base,
      projectName: options?.projectName,
    }),
  });

  if (!result.sent && !result.devLogged) {
    await prisma.notificationEmailLog
      .delete({
        where: {
          user_id_notification_key: {
            user_id: userId,
            notification_key: item.id,
          },
        },
      })
      .catch(() => undefined);
    logNotificationEmailFailure(
      new Error(result.error ?? "email_send_failed"),
      {
        userId,
        email,
        notificationKey: item.id,
      }
    );
    return false;
  }

  return true;
}

/** Send to an address that is not a registered user (no prefs / NotificationEmailLog). */
async function sendAdditionalRecipientEmail(
  email: string,
  item: DashboardNotificationItem,
  options?: {
    rule?: AlertRuleType | null;
    projectName?: string | null;
  }
): Promise<boolean> {
  const base = dashboardOriginOrNull();
  const kind = inferNotificationEmailKind(item, options?.rule);
  const result = await sendTransactionalEmail({
    to: email,
    subject: buildNotificationEmailSubject(item, kind),
    html: buildNotificationEmailHtml({
      item,
      kind,
      dashboardOrigin: base,
      projectName: options?.projectName,
    }),
  });
  return Boolean(result.sent || result.devLogged);
}

export async function notifyOrganizationMembersByEmail(
  prisma: PrismaClient,
  organizationId: string,
  item: DashboardNotificationItem,
  options?: {
    roles?: OrgRole[];
    excludeEmails?: string[];
    rule?: AlertRuleType | null;
    projectName?: string | null;
  }
): Promise<void> {
  const roles = options?.roles ?? [OrgRole.OWNER, OrgRole.EDITOR, OrgRole.VIEWER];
  const excludeEmails = new Set(
    (options?.excludeEmails ?? []).map((address) => normalizeEmail(address))
  );
  const members = await prisma.organizationMembership.findMany({
    where: {
      organization_id: organizationId,
      role: { in: roles },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          notification_preferences: true,
        },
      },
    },
  });

  await Promise.all(
    members
      .filter((member) => !excludeEmails.has(normalizeEmail(member.user.email)))
      .map((member) =>
        settleNotificationEmail(
          sendNotificationEmailIfAllowed(
            prisma,
            member.user.id,
            member.user.email,
            item,
            parseNotificationPreferences(member.user.notification_preferences),
            { rule: options?.rule, projectName: options?.projectName }
          ),
          {
            userId: member.user.id,
            email: member.user.email,
            notificationKey: item.id,
          }
        )
      )
  );
}

export async function notifyProjectMembersByEmail(
  prisma: PrismaClient,
  projectId: string,
  item: DashboardNotificationItem,
  options?: {
    roles?: OrgRole[];
    rule?: AlertRuleType | null;
    /** When true (default for alerts), honor project alert email settings. */
    respectProjectEmailSettings?: boolean;
  }
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { organization_id: true, alert_settings: true, name: true },
  });
  if (!project) return;

  const respect = options?.respectProjectEmailSettings !== false;
  const settings = parseProjectAlertSettings(project.alert_settings);

  if (respect && !settings.email.enabled) {
    return;
  }

  const roles =
    options?.roles ??
    (respect
      ? alertEmailRolesToOrgRoles(settings.email.roles)
      : [OrgRole.OWNER, OrgRole.EDITOR]);

  await notifyOrganizationMembersByEmail(
    prisma,
    project.organization_id,
    item,
    {
      roles,
      rule: options?.rule,
      projectName: project.name,
    }
  );

  if (!respect || settings.email.additionalEmails.length === 0) {
    return;
  }

  const memberEmails = new Set(
    (
      await prisma.organizationMembership.findMany({
        where: {
          organization_id: project.organization_id,
          role: { in: roles },
        },
        select: { user: { select: { email: true } } },
      })
    ).map((row) => normalizeEmail(row.user.email))
  );

  const extra = settings.email.additionalEmails
    .map(normalizeEmail)
    .filter((address) => isValidEmailAddress(address) && !memberEmails.has(address));

  if (extra.length === 0) return;

  const knownUsers = await prisma.user.findMany({
    where: { email: { in: extra } },
    select: {
      id: true,
      email: true,
      notification_preferences: true,
    },
  });
  const knownByEmail = new Map(
    knownUsers.map((user) => [normalizeEmail(user.email), user])
  );

  await Promise.all(
    extra.map(async (address) => {
      const user = knownByEmail.get(address);
      try {
        if (user) {
          await sendNotificationEmailIfAllowed(
            prisma,
            user.id,
            user.email,
            item,
            parseNotificationPreferences(user.notification_preferences),
            { rule: options?.rule, projectName: project.name }
          );
          return;
        }
        await sendAdditionalRecipientEmail(address, item, {
          rule: options?.rule,
          projectName: project.name,
        });
      } catch (error) {
        logNotificationEmailFailure(error, {
          userId: user?.id,
          email: address,
          notificationKey: item.id,
        });
      }
    })
  );
}

export async function notifyNewErrorGroupEmail(
  prisma: PrismaClient,
  projectId: string,
  group: {
    id: string;
    message: string;
    app: string;
    environment: string | null;
  }
): Promise<void> {
  const envPart = group.environment ? ` · ${group.environment}` : "";
  // type "issue" → Issues email routing (not Alerts). Project recipient list still applies.
  const item: DashboardNotificationItem = {
    id: `issue:${group.id}`,
    type: "issue",
    title: "New error group",
    body: `${group.message.slice(0, 160)} · app ${group.app}${envPart}`,
    occurredAt: new Date().toISOString(),
    href: `/dashboard/errors/${group.id}`,
  };
  await notifyProjectMembersByEmail(prisma, projectId, item);
}

/** @deprecated Prefer fireProjectAlert via maybeNotifyQuotaAlerts */
export async function notifyQuotaThresholdEmail(
  prisma: PrismaClient,
  projectId: string,
  kind: "near" | "exceeded",
  details: {
    planTier: string;
    monthlyIngestUsed: number;
    monthlyIngestLimit: number;
    percentUsed: number;
  }
): Promise<void> {
  const item: DashboardNotificationItem =
    kind === "exceeded"
      ? {
          id: quotaNotificationKey(projectId, "exceeded"),
          type: "quota",
          title: "Monthly ingest limit reached",
          body: `${details.monthlyIngestUsed.toLocaleString()} / ${details.monthlyIngestLimit.toLocaleString()} units on your ${details.planTier} plan.`,
          occurredAt: new Date().toISOString(),
          href: "/dashboard/settings/billing",
        }
      : {
          id: quotaNotificationKey(projectId, "near"),
          type: "quota",
          title: "Usage approaching limit",
          body: `${details.percentUsed}% of your ${details.planTier} plan monthly ingest.`,
          occurredAt: new Date().toISOString(),
          href: "/dashboard/settings/billing",
        };
  await notifyProjectMembersByEmail(prisma, projectId, item, {
    roles: [OrgRole.OWNER, OrgRole.EDITOR],
  });
}

export async function notifyBillingAlertEmail(
  prisma: PrismaClient,
  organizationId: string,
  variant: BillingAlertVariant,
  storedPlanTier: string,
  effectivePlanTier: string,
  stripeCurrentPeriodEnd?: Date | string | null
): Promise<void> {
  const { title, body } = billingAlertNotificationContent(
    variant,
    storedPlanTier,
    effectivePlanTier
  );
  const item: DashboardNotificationItem = {
    id: billingNotificationKey(
      organizationId,
      variant,
      stripeCurrentPeriodEnd
    ),
    type: "billing",
    title,
    body,
    occurredAt: new Date().toISOString(),
    href: "/dashboard/settings/billing",
  };
  await notifyOrganizationMembersByEmail(prisma, organizationId, item, {
    roles: [OrgRole.OWNER, OrgRole.EDITOR],
  });
}

export async function notifyTeamMemberJoinedEmail(
  prisma: PrismaClient,
  organizationId: string,
  member: {
    membershipId: string;
    email: string;
    displayName: string | null;
    role: string;
  }
): Promise<void> {
  const name = member.displayName?.trim() || member.email;
  const item: DashboardNotificationItem = {
    id: `team:member:${member.membershipId}`,
    type: "team",
    title: "New team member",
    body: `${name} joined your organization as ${member.role}.`,
    occurredAt: new Date().toISOString(),
    href: "/dashboard/settings/team",
  };
  await notifyOrganizationMembersByEmail(prisma, organizationId, item, {
    roles: [OrgRole.OWNER, OrgRole.EDITOR],
    excludeEmails: [member.email],
  });
}

/** @deprecated Use maybeNotifyQuotaAlerts from quota-alert.js */
export async function maybeNotifyQuotaAfterIngest(
  prisma: PrismaClient,
  projectId: string
): Promise<void> {
  const { maybeNotifyQuotaAlerts } = await import("./quota-alert.js");
  await maybeNotifyQuotaAlerts(prisma, projectId);
}

export async function shouldSendInviteEmail(
  prisma: PrismaClient,
  inviteeEmail: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email: inviteeEmail.trim().toLowerCase() },
    select: { notification_preferences: true },
  });
  if (!user) return true;
  const prefs = parseNotificationPreferences(user.notification_preferences);
  const item: DashboardNotificationItem = {
    id: "team:invite:probe",
    type: "team",
    title: "Invite",
    body: "",
    occurredAt: new Date().toISOString(),
    href: null,
  };
  return shouldSendEmailForItem(prefs, item);
}

export async function sendOrganizationInviteEmail(
  prisma: PrismaClient,
  invite: { id: string; email: string; token: string },
  inviteUrl: string
): Promise<void> {
  if (!(await shouldSendInviteEmail(prisma, invite.email))) return;

  const notificationKey = teamInviteNotificationKey(invite.id, invite.token);
  const item: DashboardNotificationItem = {
    id: notificationKey,
    type: "team",
    title: "You're invited to Telemetry Tracker",
    body: "You were invited to join an organization on Telemetry Tracker.",
    occurredAt: new Date().toISOString(),
    href: `/register?invite=${encodeURIComponent(invite.token)}`,
  };

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(invite.email) },
    select: {
      id: true,
      email: true,
      notification_preferences: true,
    },
  });

  if (user) {
    await sendNotificationEmailIfAllowed(
      prisma,
      user.id,
      user.email,
      item,
      parseNotificationPreferences(user.notification_preferences)
    );
    return;
  }

  const existing = await prisma.organizationInvite.findUnique({
    where: { id: invite.id },
    select: { invite_email_sent_token: true },
  });
  if (existing?.invite_email_sent_token === invite.token) return;

  const previousToken = existing?.invite_email_sent_token ?? null;
  const claimed = await prisma.organizationInvite.updateMany({
    where: {
      id: invite.id,
      invite_email_sent_token: previousToken,
    },
    data: { invite_email_sent_token: invite.token },
  });
  if (claimed.count === 0) return;

  const base = dashboardOriginOrNull();
  const kind = inferNotificationEmailKind(item);
  const result = await sendTransactionalEmail({
    to: invite.email,
    subject: buildNotificationEmailSubject(item, kind),
    html: buildNotificationEmailHtml({
      item: { ...item, href: inviteUrl },
      kind,
      dashboardOrigin: base,
    }),
  });

  if (!result.sent && !result.devLogged) {
    await prisma.organizationInvite
      .update({
        where: { id: invite.id },
        data: { invite_email_sent_token: previousToken },
      })
      .catch(() => undefined);
  }
}
