/**
 * Provider-specific outbound alert bodies for chat Incoming Webhooks / Bot APIs.
 * Generic HTTPS destinations keep the `alert.fired` JSON from alert-webhook-dispatch (#225).
 */
import type { AlertRuleType, AlertWebhookProvider, Prisma } from "@prisma/client";
import { dashboardOriginOrNull } from "./dashboard-origin.js";

export type AlertChannelPayloadInput = {
  deliveryId: string;
  projectId: string;
  rule: AlertRuleType;
  title: string;
  body: string;
  href: string | null;
  dedupeKey: string;
  firedAt?: Date;
};

export type TelegramWebhookConfig = {
  chatId: string;
};

const RULE_LABEL: Record<AlertRuleType, string> = {
  CHECKIN_DOWN: "Check-in down",
  CHECKIN_RECOVERED: "Check-in recovered",
  ERROR_SPIKE: "Error spike",
  QUOTA_NEAR: "Quota near limit",
  QUOTA_EXCEEDED: "Quota exceeded",
  ALERT_RULE: "Alert rule",
};

/** Discord embed accent (blurple). */
const DISCORD_EMBED_COLOR = 0x5865f2;
/** Teams MessageCard theme. */
const TEAMS_THEME_COLOR = "5865F2";

export function parseAlertWebhookProvider(
  raw: unknown
): AlertWebhookProvider | null {
  if (raw === "GENERIC" || raw === "SLACK" || raw === "DISCORD") return raw;
  if (raw === "MICROSOFT_TEAMS" || raw === "TELEGRAM") return raw;
  return null;
}

export function providerUsesSigningSecret(provider: AlertWebhookProvider): boolean {
  return provider === "GENERIC";
}

export function providerDisplayName(provider: AlertWebhookProvider): string {
  switch (provider) {
    case "GENERIC":
      return "Webhook";
    case "SLACK":
      return "Slack";
    case "DISCORD":
      return "Discord";
    case "MICROSOFT_TEAMS":
      return "Microsoft Teams";
    case "TELEGRAM":
      return "Telegram";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

function absoluteChannelHref(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const base = dashboardOriginOrNull();
  if (!base) return href;
  return `${base.replace(/\/$/, "")}${href.startsWith("/") ? href : `/${href}`}`;
}

/**
 * Validate provider-specific HTTPS URL shape after generic HTTPS/SSRF checks.
 */
export function validateProviderWebhookUrl(
  provider: AlertWebhookProvider,
  url: string
): { ok: true } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Webhook URL is invalid" };
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  switch (provider) {
    case "GENERIC":
      return { ok: true };
    case "SLACK":
      if (host !== "hooks.slack.com") {
        return {
          ok: false,
          error: "Slack webhook URL must use https://hooks.slack.com/…",
        };
      }
      if (!path.startsWith("/services/")) {
        return {
          ok: false,
          error: "Slack Incoming Webhook path must start with /services/",
        };
      }
      return { ok: true };
    case "DISCORD":
      if (host !== "discord.com" && host !== "discordapp.com") {
        return {
          ok: false,
          error: "Discord webhook URL must use discord.com or discordapp.com",
        };
      }
      if (!/^\/api\/webhooks\/\d+\/[^/]+/.test(path)) {
        return {
          ok: false,
          error: "Discord webhook path must be /api/webhooks/{id}/{token}",
        };
      }
      return { ok: true };
    case "MICROSOFT_TEAMS":
      // Incoming Webhook hosts only — not arbitrary *.office.com (forms, sharepoint, etc.).
      if (
        host === "outlook.office.com" ||
        host === "webhook.office.com" ||
        host.endsWith(".webhook.office.com") ||
        host.endsWith(".logic.azure.com") ||
        host.endsWith(".environment.api.powerplatform.com")
      ) {
        return { ok: true };
      }
      return {
        ok: false,
        error:
          "Microsoft Teams webhook URL must be an Office 365 Incoming Webhook or Power Automate HTTPS endpoint",
      };
    case "TELEGRAM":
      if (host !== "api.telegram.org") {
        return {
          ok: false,
          error: "Telegram URL must use https://api.telegram.org/bot…/sendMessage",
        };
      }
      if (!/^\/bot[^/]+\/sendMessage\/?$/.test(path)) {
        return {
          ok: false,
          error: "Telegram URL path must be /bot<token>/sendMessage",
        };
      }
      return { ok: true };
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function parseTelegramWebhookConfig(
  raw: unknown
): { ok: true; config: TelegramWebhookConfig } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Telegram chat id is required" };
  }
  const chatIdRaw = (raw as { chatId?: unknown }).chatId;
  if (typeof chatIdRaw !== "string" && typeof chatIdRaw !== "number") {
    return { ok: false, error: "Telegram chat id is required" };
  }
  const chatId = String(chatIdRaw).trim();
  if (chatId.length === 0 || chatId.length > 64) {
    return { ok: false, error: "Telegram chat id is invalid" };
  }
  // Numeric ids (optionally negative for groups) or @public_username
  if (!/^@?[A-Za-z0-9_]{1,64}$/.test(chatId) && !/^-?\d{1,20}$/.test(chatId)) {
    return { ok: false, error: "Telegram chat id is invalid" };
  }
  return { ok: true, config: { chatId } };
}

export function telegramConfigFromJson(
  value: Prisma.JsonValue | null | undefined
): TelegramWebhookConfig | null {
  if (value === null || value === undefined) return null;
  const parsed = parseTelegramWebhookConfig(value);
  return parsed.ok ? parsed.config : null;
}

export function buildSlackIncomingWebhookBody(input: AlertChannelPayloadInput): string {
  const href = absoluteChannelHref(input.href);
  const rule = RULE_LABEL[input.rule] ?? input.rule;
  const lines = [`*${input.title}*`, input.body, `_${rule}_`];
  if (href) {
    lines.push(`<${href}|Open in Telemetry Tracker>`);
  }
  return JSON.stringify({
    text: `${input.title}\n${input.body}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: lines.join("\n"),
        },
      },
    ],
  });
}

export function buildDiscordWebhookBody(input: AlertChannelPayloadInput): string {
  const href = absoluteChannelHref(input.href);
  const rule = RULE_LABEL[input.rule] ?? input.rule;
  const embed: Record<string, unknown> = {
    title: input.title.slice(0, 256),
    description: input.body.slice(0, 4096),
    color: DISCORD_EMBED_COLOR,
    fields: [{ name: "Rule", value: rule, inline: true }],
    footer: { text: "Telemetry Tracker" },
  };
  if (href) {
    embed.url = href;
  }
  return JSON.stringify({
    username: "Telemetry Tracker",
    embeds: [embed],
  });
}

export function buildMicrosoftTeamsWebhookBody(input: AlertChannelPayloadInput): string {
  const href = absoluteChannelHref(input.href);
  const rule = RULE_LABEL[input.rule] ?? input.rule;
  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: TEAMS_THEME_COLOR,
    summary: input.title,
    title: input.title,
    text: `${input.body}\n\n**Rule:** ${rule}`,
  };
  if (href) {
    card.potentialAction = [
      {
        "@type": "OpenUri",
        name: "Open in Telemetry Tracker",
        targets: [{ os: "default", uri: href }],
      },
    ];
  }
  return JSON.stringify(card);
}

export function buildTelegramSendMessageBody(
  input: AlertChannelPayloadInput,
  config: TelegramWebhookConfig
): string {
  const href = absoluteChannelHref(input.href);
  const rule = RULE_LABEL[input.rule] ?? input.rule;
  const parts = [
    `<b>${escapeTelegramHtml(input.title)}</b>`,
    escapeTelegramHtml(input.body),
    `<i>${escapeTelegramHtml(rule)}</i>`,
  ];
  if (href) {
    parts.push(`<a href="${escapeTelegramAttr(href)}">Open in Telemetry Tracker</a>`);
  }
  return JSON.stringify({
    chat_id: config.chatId,
    text: parts.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttr(value: string): string {
  return escapeTelegramHtml(value).replace(/"/g, "&quot;");
}

/**
 * Serialize the POST body for a destination.
 * Chat providers get native shapes; GENERIC keeps `alert.fired` JSON.
 */
export function buildAlertDeliveryBody(
  provider: AlertWebhookProvider,
  input: AlertChannelPayloadInput,
  genericBody: string,
  config?: Prisma.JsonValue | null
): { ok: true; body: string } | { ok: false; error: string } {
  switch (provider) {
    case "GENERIC":
      return { ok: true, body: genericBody };
    case "SLACK":
      return { ok: true, body: buildSlackIncomingWebhookBody(input) };
    case "DISCORD":
      return { ok: true, body: buildDiscordWebhookBody(input) };
    case "MICROSOFT_TEAMS":
      return { ok: true, body: buildMicrosoftTeamsWebhookBody(input) };
    case "TELEGRAM": {
      const telegram = telegramConfigFromJson(config);
      if (!telegram) {
        return { ok: false, error: "Telegram chat id is missing" };
      }
      return {
        ok: true,
        body: buildTelegramSendMessageBody(input, telegram),
      };
    }
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
