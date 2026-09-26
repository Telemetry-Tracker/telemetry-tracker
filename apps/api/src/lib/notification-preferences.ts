import { z } from "zod";
import type { DashboardNotificationItem } from "./dashboard-notifications.js";

export type NotificationCategory = "issues" | "billing" | "team" | "alerts";
export type NotificationChannel = "inapp" | "email";

export type NotificationPreferences = {
  channels: Record<NotificationChannel, boolean>;
  routing: Record<
    NotificationCategory,
    Record<NotificationChannel, boolean>
  >;
  quietHours: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    timezone: string;
  };
  /**
   * When set to an ISO timestamp in the future, mute non-critical in-app and
   * email notifications until that instant. Critical billing/quota/alert items
   * still deliver.
   */
  mutedUntil: string | null;
  /**
   * Reserved for digest scheduling (#499 follow-up). Stored so clients can
   * round-trip without losing intent; delivery is not implemented yet.
   */
  digest: "off" | "daily" | "weekly";
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: { inapp: true, email: true },
  routing: {
    issues: { inapp: true, email: false },
    billing: { inapp: true, email: true },
    team: { inapp: true, email: true },
    alerts: { inapp: true, email: true },
  },
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 7,
    timezone: "UTC",
  },
  mutedUntil: null,
  digest: "off",
};

const hourSchema = z.number().int().min(0).max(23);

const preferencesSchema = z.object({
  channels: z.object({
    inapp: z.boolean(),
    email: z.boolean(),
  }),
  routing: z.object({
    issues: z.object({ inapp: z.boolean(), email: z.boolean() }),
    billing: z.object({ inapp: z.boolean(), email: z.boolean() }),
    team: z.object({ inapp: z.boolean(), email: z.boolean() }),
    alerts: z
      .object({ inapp: z.boolean(), email: z.boolean() })
      .optional(),
  }),
  quietHours: z.object({
    enabled: z.boolean(),
    startHour: hourSchema,
    endHour: hourSchema,
    timezone: z.string().min(1).max(64),
  }),
  mutedUntil: z
    .union([z.string().min(1).max(64), z.null()])
    .optional(),
  digest: z.enum(["off", "daily", "weekly"]).optional(),
});

function normalizeMutedUntil(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function normalizeNotificationPreferences(
  data: z.infer<typeof preferencesSchema>,
  previous?: NotificationPreferences
): NotificationPreferences {
  return {
    channels: data.channels,
    routing: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.routing,
      ...data.routing,
      alerts:
        data.routing.alerts ??
        previous?.routing.alerts ??
        DEFAULT_NOTIFICATION_PREFERENCES.routing.alerts,
    },
    quietHours: data.quietHours,
    // Omitting optional fields preserves stored values on PATCH; parse (no
    // previous) still falls back to defaults for legacy JSON.
    mutedUntil:
      data.mutedUntil !== undefined
        ? normalizeMutedUntil(data.mutedUntil)
        : (previous?.mutedUntil ?? null),
    digest:
      data.digest !== undefined
        ? data.digest
        : (previous?.digest ?? DEFAULT_NOTIFICATION_PREFERENCES.digest),
  };
}

export function parseNotificationPreferences(
  raw: unknown
): NotificationPreferences {
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  return normalizeNotificationPreferences(parsed.data);
}

export function validateNotificationPreferencesPatch(
  body: unknown,
  previous: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES
): { ok: true; preferences: NotificationPreferences } | { ok: false; error: string } {
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Invalid notification preferences payload" };
  }
  return {
    ok: true,
    preferences: normalizeNotificationPreferences(parsed.data, previous),
  };
}

export function categoryForNotificationType(
  type: DashboardNotificationItem["type"]
): NotificationCategory {
  if (type === "issue") return "issues";
  if (type === "team") return "team";
  if (type === "alert") return "alerts";
  return "billing";
}

export function isCriticalInAppNotification(
  item: DashboardNotificationItem
): boolean {
  return item.type === "billing" || item.type === "quota" || item.type === "alert";
}

/** Critical emails bypass quiet hours and temporary mute. */
export function isCriticalEmailNotification(
  item: DashboardNotificationItem
): boolean {
  return isCriticalInAppNotification(item);
}

export function isMuted(
  prefs: NotificationPreferences,
  now = new Date()
): boolean {
  if (!prefs.mutedUntil) return false;
  const until = Date.parse(prefs.mutedUntil);
  if (!Number.isFinite(until)) return false;
  return now.getTime() < until;
}

export function shouldSendEmailForCategory(
  prefs: NotificationPreferences,
  category: NotificationCategory
): boolean {
  if (!prefs.channels.email) return false;
  return prefs.routing[category].email;
}

export function shouldSendEmailForItem(
  prefs: NotificationPreferences,
  item: DashboardNotificationItem,
  now = new Date()
): boolean {
  const category = categoryForNotificationType(item.type);
  if (!shouldSendEmailForCategory(prefs, category)) return false;

  const critical = isCriticalEmailNotification(item);
  if (!critical && isMuted(prefs, now)) return false;
  if (!critical && isInQuietHours(prefs, now)) return false;

  return true;
}

/** Hour (0–23) in the given IANA timezone; falls back to UTC. */
export function currentHourInTimezone(timezone: string, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour");
    const hour = hourPart ? Number(hourPart.value) : Number.NaN;
    if (Number.isFinite(hour)) {
      return hour === 24 ? 0 : hour;
    }
  } catch {
    /* invalid timezone */
  }
  return now.getUTCHours();
}

export function isInQuietHours(
  prefs: NotificationPreferences,
  now = new Date()
): boolean {
  if (!prefs.quietHours.enabled) return false;
  const hour = currentHourInTimezone(prefs.quietHours.timezone, now);
  const { startHour, endHour } = prefs.quietHours;
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function shouldShowInAppNotification(
  item: DashboardNotificationItem,
  prefs: NotificationPreferences,
  now = new Date()
): boolean {
  if (!prefs.channels.inapp) return false;

  const category = categoryForNotificationType(item.type);
  if (!prefs.routing[category].inapp) return false;

  const critical = isCriticalInAppNotification(item);
  if (!critical && isMuted(prefs, now)) return false;

  if (!critical && isInQuietHours(prefs, now)) {
    return false;
  }

  return true;
}

export function filterInAppNotifications(
  items: DashboardNotificationItem[],
  prefs: NotificationPreferences,
  now = new Date()
): DashboardNotificationItem[] {
  return items.filter((item) => shouldShowInAppNotification(item, prefs, now));
}

/** For mark-all-read: respect routing but not quiet-hours / mute hiding. */
export function filterInAppNotificationsForReadPersistence(
  items: DashboardNotificationItem[],
  prefs: NotificationPreferences
): DashboardNotificationItem[] {
  if (!prefs.channels.inapp) return [];
  return items.filter((item) => {
    const category = categoryForNotificationType(item.type);
    return prefs.routing[category].inapp;
  });
}
