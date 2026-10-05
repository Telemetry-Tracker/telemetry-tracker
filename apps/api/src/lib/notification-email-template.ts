import type { AlertRuleType } from "@prisma/client";
import type { DashboardNotificationItem } from "./dashboard-notifications.js";
import {
  EMAIL_COLORS,
  EMAIL_FONT_FAMILY,
  emailDocumentHead,
  emailSolidFill,
  escapeHtml,
  renderEmailBrandHeader,
  renderEmailPrimaryCta,
} from "./email-chrome.js";

export { escapeHtml };

const COLORS = EMAIL_COLORS;

export type NotificationEmailKind =
  | "error_spike"
  | "new_error"
  | "quota_near"
  | "quota_exceeded"
  | "custom_alert"
  | "billing"
  | "team"
  | "generic";

function absoluteHref(href: string | null, base: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (!base) return href;
  return `${base.replace(/\/$/, "")}${href.startsWith("/") ? href : `/${href}`}`;
}

export function inferNotificationEmailKind(
  item: DashboardNotificationItem,
  rule?: AlertRuleType | null
): NotificationEmailKind {
  if (rule === "ERROR_SPIKE") return "error_spike";
  if (rule === "QUOTA_NEAR") return "quota_near";
  if (rule === "QUOTA_EXCEEDED") return "quota_exceeded";
  if (rule === "ALERT_RULE") return "custom_alert";

  if (item.type === "issue") return "new_error";
  if (item.type === "billing") return "billing";
  if (item.type === "team") return "team";

  if (item.type === "quota") {
    return item.id.includes(":exceeded:") ? "quota_exceeded" : "quota_near";
  }

  if (item.type === "alert") {
    if (item.id.startsWith("alert:error_spike:")) return "error_spike";
    if (item.id.startsWith("alert:rule:")) return "custom_alert";
    if (item.id.startsWith("quota:exceeded:")) return "quota_exceeded";
    if (item.id.startsWith("quota:near:")) return "quota_near";
    return "custom_alert";
  }

  return "generic";
}

type KindMeta = {
  badge: string;
  badgeBg: string;
  badgeFg: string;
  cta: string;
  footer: string;
};

function kindMeta(kind: NotificationEmailKind): KindMeta {
  switch (kind) {
    case "error_spike":
      return {
        badge: "Error spike",
        badgeBg: COLORS.dangerSoft,
        badgeFg: COLORS.danger,
        cta: "View errors",
        footer: "You received this because error spike alerts are enabled for a project you can access.",
      };
    case "new_error":
      return {
        badge: "New error",
        badgeBg: COLORS.dangerSoft,
        badgeFg: COLORS.danger,
        cta: "Open error group",
        footer: "You received this because issue email notifications are enabled for your account.",
      };
    case "quota_near":
      return {
        badge: "Quota warning",
        badgeBg: COLORS.warningSoft,
        badgeFg: COLORS.warning,
        cta: "View billing",
        footer: "You received this because quota alerts are enabled for a project you can access.",
      };
    case "quota_exceeded":
      return {
        badge: "Quota exceeded",
        badgeBg: COLORS.dangerSoft,
        badgeFg: COLORS.danger,
        cta: "View billing",
        footer: "You received this because ingest for a project you can access hit the monthly limit.",
      };
    case "custom_alert":
      return {
        badge: "Alert",
        badgeBg: COLORS.brandSoft,
        badgeFg: COLORS.brand,
        cta: "Open alert",
        footer: "You received this because project alert email delivery is enabled.",
      };
    case "billing":
      return {
        badge: "Billing",
        badgeBg: COLORS.warningSoft,
        badgeFg: COLORS.warning,
        cta: "View billing",
        footer: "You received this because billing email notifications are enabled for your account.",
      };
    case "team":
      return {
        badge: "Team",
        badgeBg: COLORS.brandSoft,
        badgeFg: COLORS.brand,
        cta: "Open team",
        footer: "You received this because team email notifications are enabled for your account.",
      };
    default:
      return {
        badge: "Notification",
        badgeBg: COLORS.brandSoft,
        badgeFg: COLORS.brand,
        cta: "Open dashboard",
        footer: "You received this from Telemetry Tracker.",
      };
  }
}

export function buildNotificationEmailSubject(
  item: DashboardNotificationItem,
  kind: NotificationEmailKind
): string {
  const prefix =
    kind === "error_spike"
      ? "Error spike"
      : kind === "new_error"
        ? "New error"
        : kind === "quota_near"
          ? "Quota warning"
          : kind === "quota_exceeded"
            ? "Quota exceeded"
            : kind === "custom_alert"
              ? "Alert"
              : "Telemetry Tracker";
  return `[${prefix}] ${item.title}`;
}

export function buildNotificationEmailHtml(options: {
  item: DashboardNotificationItem;
  kind: NotificationEmailKind;
  dashboardOrigin: string | null;
  projectName?: string | null;
}): string {
  const { item, kind, dashboardOrigin, projectName } = options;
  const meta = kindMeta(kind);
  if (item.id.startsWith("team:invite:")) {
    meta.cta = "Accept invite";
    meta.footer = "You were invited to join an organization on Telemetry Tracker.";
  }
  const origin = dashboardOrigin?.replace(/\/$/, "") ?? null;
  const link = absoluteHref(item.href, origin);
  const prefsUrl = origin ? `${origin}/dashboard/settings/notifications` : null;
  const pageFill = emailSolidFill(COLORS.background);
  const cardFill = emailSolidFill(COLORS.card);
  const projectLine = projectName?.trim()
    ? `<p style="margin:0 0 16px;font-size:13px;color:${COLORS.muted};">Project · <strong style="color:${COLORS.foreground};font-weight:600;">${escapeHtml(projectName.trim())}</strong></p>`
    : "";

  const ctaBlock = link
    ? `<tr>
            <td bgcolor="${COLORS.card}" style="padding:8px 28px 28px;${cardFill}">
              ${renderEmailPrimaryCta(link, meta.cta)}
            </td>
          </tr>`
    : "";

  const prefsLine = prefsUrl
    ? ` <a href="${escapeHtml(prefsUrl)}" style="color:${COLORS.muted};text-decoration:underline;">Manage notification preferences</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
${emailDocumentHead(item.title)}
<body bgcolor="${COLORS.background}" style="margin:0;padding:0;${pageFill}color:${COLORS.foreground};font-family:${EMAIL_FONT_FAMILY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.background}" style="${pageFill}padding:32px 16px;">
    <tr>
      <td align="center" bgcolor="${COLORS.background}" style="${pageFill}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.card}" style="max-width:560px;${cardFill}border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
          ${renderEmailBrandHeader({
            badgeLabel: meta.badge,
            badgeBackground: meta.badgeBg,
            badgeColor: meta.badgeFg,
          })}
          <tr>
            <td bgcolor="${COLORS.card}" style="padding:28px 28px 8px;${cardFill}color:${COLORS.foreground};">
              ${projectLine}
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;line-height:1.3;letter-spacing:-0.02em;color:${COLORS.foreground};">${escapeHtml(item.title)}</h1>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:${COLORS.foreground};">${escapeHtml(item.body)}</p>
            </td>
          </tr>
          ${ctaBlock}
        </table>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${COLORS.muted};max-width:560px;text-align:center;">
          ${escapeHtml(meta.footer)}${prefsLine}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
