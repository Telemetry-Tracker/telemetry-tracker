import { describe, expect, it } from "vitest";
import type { DashboardNotificationItem } from "./dashboard-notifications.js";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  filterInAppNotifications,
  filterInAppNotificationsForReadPersistence,
  isInQuietHours,
  isMuted,
  parseNotificationPreferences,
  shouldSendEmailForCategory,
  shouldSendEmailForItem,
  shouldShowInAppNotification,
  validateNotificationPreferencesPatch,
} from "./notification-preferences.js";

const issue: DashboardNotificationItem = {
  id: "issue:1",
  type: "issue",
  title: "Error",
  body: "body",
  occurredAt: new Date().toISOString(),
  href: "/dashboard/errors/1",
};

const billing: DashboardNotificationItem = {
  id: "billing:past_due",
  type: "billing",
  title: "Payment past due",
  body: "body",
  occurredAt: new Date().toISOString(),
  href: "/dashboard/settings/billing",
};

const alert: DashboardNotificationItem = {
  id: "alert:error_spike:p1:15:1",
  type: "alert",
  title: "Error spike detected",
  body: "body",
  occurredAt: new Date().toISOString(),
  href: "/dashboard/errors",
};

describe("notification-preferences", () => {
  it("sends alert email for a new account that has not saved preferences", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.channels.email).toBe(true);
    expect(shouldSendEmailForCategory(DEFAULT_NOTIFICATION_PREFERENCES, "alerts")).toBe(
      true
    );
    expect(shouldSendEmailForCategory(DEFAULT_NOTIFICATION_PREFERENCES, "issues")).toBe(
      false
    );
  });

  it("returns defaults for invalid stored JSON", () => {
    expect(parseNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(parseNotificationPreferences({ channels: {} })).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    );
  });

  it("parses mutedUntil and digest with defaults", () => {
    const prefs = parseNotificationPreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      mutedUntil: "2026-07-17T18:00:00.000Z",
      digest: "daily",
    });
    expect(prefs.mutedUntil).toBe("2026-07-17T18:00:00.000Z");
    expect(prefs.digest).toBe("daily");
  });

  it("preserves mutedUntil and digest when patch omits them", () => {
    const previous = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      mutedUntil: "2026-07-17T20:00:00.000Z",
      digest: "weekly" as const,
    };
    const result = validateNotificationPreferencesPatch(
      {
        channels: { inapp: true, email: true },
        routing: DEFAULT_NOTIFICATION_PREFERENCES.routing,
        quietHours: DEFAULT_NOTIFICATION_PREFERENCES.quietHours,
      },
      previous
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preferences.mutedUntil).toBe(previous.mutedUntil);
      expect(result.preferences.digest).toBe("weekly");
      expect(result.preferences.channels.email).toBe(true);
    }
  });

  it("clears mute and updates digest when patch sets them explicitly", () => {
    const previous = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      mutedUntil: "2026-07-17T20:00:00.000Z",
      digest: "daily" as const,
    };
    const result = validateNotificationPreferencesPatch(
      {
        channels: DEFAULT_NOTIFICATION_PREFERENCES.channels,
        routing: DEFAULT_NOTIFICATION_PREFERENCES.routing,
        quietHours: DEFAULT_NOTIFICATION_PREFERENCES.quietHours,
        mutedUntil: null,
        digest: "off",
      },
      previous
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preferences.mutedUntil).toBeNull();
      expect(result.preferences.digest).toBe("off");
    }
  });

  it("filters issues when in-app routing is disabled", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      routing: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.routing,
        issues: { inapp: false, email: false },
      },
    };
    expect(filterInAppNotifications([issue, billing], prefs)).toEqual([billing]);
  });

  it("hides non-critical notifications during quiet hours", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHours: {
        enabled: true,
        startHour: 0,
        endHour: 24,
        timezone: "UTC",
      },
    };
    const noon = new Date("2026-07-01T12:00:00.000Z");
    expect(shouldShowInAppNotification(issue, prefs, noon)).toBe(false);
    expect(shouldShowInAppNotification(billing, prefs, noon)).toBe(true);
  });

  it("detects quiet hours spanning midnight", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHours: {
        enabled: true,
        startHour: 22,
        endHour: 7,
        timezone: "UTC",
      },
    };
    expect(isInQuietHours(prefs, new Date("2026-07-01T23:00:00.000Z"))).toBe(true);
    expect(isInQuietHours(prefs, new Date("2026-07-01T12:00:00.000Z"))).toBe(false);
  });

  it("keeps quiet-hours-hidden items for mark-all-read persistence", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHours: {
        enabled: true,
        startHour: 0,
        endHour: 24,
        timezone: "UTC",
      },
    };
    expect(filterInAppNotifications([issue, billing], prefs)).toEqual([billing]);
    expect(filterInAppNotificationsForReadPersistence([issue, billing], prefs)).toEqual([
      issue,
      billing,
    ]);
  });

  it("mutes non-critical in-app and email until mutedUntil", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      channels: { inapp: true, email: true },
      routing: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.routing,
        issues: { inapp: true, email: true },
        alerts: { inapp: true, email: true },
      },
      mutedUntil: "2026-07-17T20:00:00.000Z",
    };
    const during = new Date("2026-07-17T19:00:00.000Z");
    const after = new Date("2026-07-17T21:00:00.000Z");
    expect(isMuted(prefs, during)).toBe(true);
    expect(shouldShowInAppNotification(issue, prefs, during)).toBe(false);
    expect(shouldShowInAppNotification(alert, prefs, during)).toBe(true);
    expect(shouldSendEmailForItem(prefs, issue, during)).toBe(false);
    expect(shouldSendEmailForItem(prefs, alert, during)).toBe(true);
    expect(shouldSendEmailForItem(prefs, issue, after)).toBe(true);
  });

  it("applies quiet hours to email for non-critical items", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      channels: { inapp: true, email: true },
      routing: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.routing,
        issues: { inapp: true, email: true },
        alerts: { inapp: true, email: true },
      },
      quietHours: {
        enabled: true,
        startHour: 0,
        endHour: 24,
        timezone: "UTC",
      },
    };
    const noon = new Date("2026-07-01T12:00:00.000Z");
    expect(shouldSendEmailForItem(prefs, issue, noon)).toBe(false);
    expect(shouldSendEmailForItem(prefs, alert, noon)).toBe(true);
  });
});
