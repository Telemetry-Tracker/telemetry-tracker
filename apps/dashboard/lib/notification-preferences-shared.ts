export type NotificationCategory = "issues" | "billing" | "team" | "alerts";
export type NotificationChannel = "inapp" | "email";
export type NotificationDigest = "off" | "daily" | "weekly";

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
  /** ISO timestamp; mute non-critical notifications until then. */
  mutedUntil: string | null;
  /** Stored for future digest delivery; not sent yet. */
  digest: NotificationDigest;
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

export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  const o = raw as Record<string, unknown>;
  const channels = o.channels;
  const routing = o.routing;
  const quietHours = o.quietHours;
  if (
    typeof channels !== "object" ||
    channels === null ||
    typeof routing !== "object" ||
    routing === null ||
    typeof quietHours !== "object" ||
    quietHours === null
  ) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  const ch = channels as Record<string, unknown>;
  const rt = routing as Record<string, unknown>;
  const qh = quietHours as Record<string, unknown>;

  function route(cat: NotificationCategory): Record<NotificationChannel, boolean> | null {
    const row = rt[cat];
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    if (typeof r.inapp !== "boolean" || typeof r.email !== "boolean") return null;
    return { inapp: r.inapp, email: r.email };
  }

  const issues = route("issues");
  const billing = route("billing");
  const team = route("team");
  const alerts = route("alerts");

  if (
    typeof ch.inapp !== "boolean" ||
    typeof ch.email !== "boolean" ||
    !issues ||
    !billing ||
    !team ||
    typeof qh.enabled !== "boolean" ||
    typeof qh.startHour !== "number" ||
    typeof qh.endHour !== "number" ||
    typeof qh.timezone !== "string"
  ) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  let mutedUntil: string | null = null;
  if (o.mutedUntil === null || o.mutedUntil === undefined) {
    mutedUntil = null;
  } else if (typeof o.mutedUntil === "string") {
    const t = Date.parse(o.mutedUntil);
    mutedUntil = Number.isFinite(t) ? new Date(t).toISOString() : null;
  } else {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  const digestRaw = o.digest;
  const digest: NotificationDigest =
    digestRaw === "daily" || digestRaw === "weekly" || digestRaw === "off"
      ? digestRaw
      : digestRaw === undefined
        ? DEFAULT_NOTIFICATION_PREFERENCES.digest
        : DEFAULT_NOTIFICATION_PREFERENCES.digest;

  return {
    channels: { inapp: ch.inapp, email: ch.email },
    routing: { issues, billing, team, alerts: alerts ?? DEFAULT_NOTIFICATION_PREFERENCES.routing.alerts },
    quietHours: {
      enabled: qh.enabled,
      startHour: qh.startHour,
      endHour: qh.endHour,
      timezone: qh.timezone,
    },
    mutedUntil,
    digest,
  };
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function preferencesEqual(
  a: NotificationPreferences,
  b: NotificationPreferences
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function muteUntilHoursFromNow(hours: number, now = new Date()): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}
