"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveNotificationPreferencesAction } from "@/app/dashboard/actions";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import {
  Field,
  FieldGroup,
  Section,
  SettingsBtn,
  SettingsSelect,
  SettingsToggle,
} from "@/app/components/dashboard/settings/settings-ui";
import {
  browserTimezone,
  muteUntilHoursFromNow,
  preferencesEqual,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDigest,
  type NotificationPreferences,
} from "@/lib/notification-preferences-shared";

const CHANNELS: { id: NotificationChannel; label: string; desc: string; disabled?: boolean }[] = [
  { id: "inapp", label: "In-app", desc: "Notification center bell" },
  {
    id: "email",
    label: "Email",
    desc: "Primary account email when RESEND is configured",
  },
];

const CATEGORIES: { id: NotificationCategory; label: string; desc: string }[] = [
  { id: "issues", label: "Issues", desc: "New error groups and open issues for the active project" },
  { id: "billing", label: "Billing", desc: "Quota thresholds and payment issues" },
  { id: "team", label: "Team", desc: "Invitations and new members in your organizations" },
  { id: "alerts", label: "Alerts", desc: "Error spikes and quota threshold rules (email templates + project recipients)" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  label: `${h.toString().padStart(2, "0")}:00`,
  value: String(h),
}));

export function NotificationsSettingsClient({
  initialPreferences,
}: {
  initialPreferences: NotificationPreferences;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(initialPreferences);
  const dirty = useMemo(
    () => !preferencesEqual(prefs, initialPreferences),
    [prefs, initialPreferences]
  );

  function setChannel(channel: NotificationChannel, enabled: boolean) {
    setPrefs((current) => ({
      ...current,
      channels: { ...current.channels, [channel]: enabled },
    }));
  }

  function setRoute(
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean
  ) {
    setPrefs((current) => ({
      ...current,
      routing: {
        ...current.routing,
        [category]: {
          ...current.routing[category],
          [channel]: enabled,
        },
      },
    }));
  }

  function save() {
    startTransition(async () => {
      const payload: NotificationPreferences = {
        ...prefs,
        quietHours: {
          ...prefs.quietHours,
          timezone:
            prefs.quietHours.timezone === "UTC" && typeof window !== "undefined"
              ? browserTimezone()
              : prefs.quietHours.timezone,
        },
      };
      const result = await saveNotificationPreferencesAction(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Notification preferences saved");
      setPrefs(result.preferences);
      router.refresh();
    });
  }

  const inappEnabled = prefs.channels.inapp;
  const emailEnabled = prefs.channels.email;

  return (
    <>
      <SettingsPageHeader
        title="Notifications"
        description="Control where and when Telemetry Tracker reaches you."
        actions={
          <SettingsBtn
            variant="primary"
            disabled={!dirty || pending}
            onClick={save}
          >
            {pending ? "Saving…" : "Save changes"}
          </SettingsBtn>
        }
      />
      <SettingsPageBody>
        <Section
          title="Channels"
          description="Turn channels on or off globally. In-app controls the bell in the top navigation."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CHANNELS.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface/40 p-3"
              >
                <span className="grid h-8 w-8 place-items-center rounded-md bg-surface text-[11px] font-mono">
                  {c.label.charAt(0)}
                </span>
                <div className="flex-1">
                  <div className="text-[13px]">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.desc}</div>
                </div>
                <SettingsToggle
                  aria-label={`${c.label} notifications`}
                  on={prefs.channels[c.id]}
                  onChange={() => setChannel(c.id, !prefs.channels[c.id])}
                />
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Routing"
          description="Choose which categories appear on each channel. Billing and alert notifications bypass quiet hours in-app."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2">Category</th>
                  {CHANNELS.map((c) => (
                    <th key={c.id} className="px-2 py-2 text-center">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CATEGORIES.map((cat) => (
                  <tr key={cat.id}>
                    <td className="px-2 py-3">
                      <div className="font-medium">{cat.label}</div>
                      <div className="text-[11px] text-muted-foreground">{cat.desc}</div>
                    </td>
                    {CHANNELS.map((c) => {
                      const channelOn =
                        c.id === "inapp" ? inappEnabled : emailEnabled;
                      const routeOn = prefs.routing[cat.id][c.id];
                      return (
                        <td key={c.id} className="px-2 py-3 text-center">
                          <div
                            className={
                              channelOn ? undefined : "pointer-events-none opacity-40"
                            }
                          >
                            <SettingsToggle
                              aria-label={`${cat.label} via ${c.label}`}
                              on={channelOn && routeOn}
                              onChange={() => setRoute(cat.id, c.id, !routeOn)}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Quiet hours"
          description={`Mute non-critical alerts during a daily window (${prefs.quietHours.timezone}). Applies to in-app and email. Issue and team notices are muted; billing, quota, and alert rules still deliver.`}
        >
          <FieldGroup>
            <Field label="Enable quiet hours">
              <SettingsToggle
                aria-label="Enable quiet hours"
                on={prefs.quietHours.enabled}
                onChange={() =>
                  setPrefs((current) => ({
                    ...current,
                    quietHours: { ...current.quietHours, enabled: !current.quietHours.enabled },
                  }))
                }
                label="Mute non-critical notifications"
              />
            </Field>
            <Field label="From / To">
              <div
                className={`flex items-center gap-2 ${prefs.quietHours.enabled ? "" : "pointer-events-none opacity-40"}`}
              >
                <SettingsSelect
                  value={String(prefs.quietHours.startHour)}
                  onChange={(v) =>
                    setPrefs((current) => ({
                      ...current,
                      quietHours: {
                        ...current.quietHours,
                        startHour: Number(v),
                      },
                    }))
                  }
                  options={HOUR_OPTIONS}
                  className="!w-28"
                />
                <span className="text-muted-foreground">→</span>
                <SettingsSelect
                  value={String(prefs.quietHours.endHour)}
                  onChange={(v) =>
                    setPrefs((current) => ({
                      ...current,
                      quietHours: {
                        ...current.quietHours,
                        endHour: Number(v),
                      },
                    }))
                  }
                  options={HOUR_OPTIONS}
                  className="!w-28"
                />
              </div>
            </Field>
          </FieldGroup>
        </Section>

        <Section
          title="Temporary mute"
          description="Pause non-critical in-app and email notifications. Billing, quota, and alert emails still arrive."
        >
          <FieldGroup>
            <Field label="Mute status">
              <p className="text-[13px] text-muted-foreground">
                {prefs.mutedUntil && Date.parse(prefs.mutedUntil) > Date.now()
                  ? `Muted until ${new Date(prefs.mutedUntil).toLocaleString()}`
                  : "Not muted"}
              </p>
            </Field>
            <Field label="Quick mute">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { label: "1 hour", hours: 1 },
                    { label: "8 hours", hours: 8 },
                    { label: "24 hours", hours: 24 },
                  ] as const
                ).map((opt) => (
                  <SettingsBtn
                    key={opt.hours}
                    variant="outline"
                    onClick={() =>
                      setPrefs((current) => ({
                        ...current,
                        mutedUntil: muteUntilHoursFromNow(opt.hours),
                      }))
                    }
                  >
                    {opt.label}
                  </SettingsBtn>
                ))}
                <SettingsBtn
                  variant="outline"
                  disabled={!prefs.mutedUntil}
                  onClick={() =>
                    setPrefs((current) => ({
                      ...current,
                      mutedUntil: null,
                    }))
                  }
                >
                  Clear mute
                </SettingsBtn>
              </div>
            </Field>
          </FieldGroup>
        </Section>

        <Section
          title="Email digests"
          description="Preference is saved for a future digest sender. Alert and billing emails stay immediate for now."
        >
          <Field label="Digest cadence">
            <SettingsSelect
              value={prefs.digest}
              onChange={(v) =>
                setPrefs((current) => ({
                  ...current,
                  digest: v as NotificationDigest,
                }))
              }
              options={[
                { label: "Off (immediate only)", value: "off" },
                { label: "Daily (coming soon)", value: "daily" },
                { label: "Weekly (coming soon)", value: "weekly" },
              ]}
              className="!w-56"
            />
          </Field>
        </Section>
      </SettingsPageBody>
    </>
  );
}
