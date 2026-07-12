"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveDashboardPreferencesAction } from "@/app/dashboard/actions";
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
  dashboardPreferencesEqual,
  type DashboardPreferences,
  type DashboardTimeRangePreset,
} from "@/lib/dashboard-preferences-shared";

const TIME_RANGE_OPTIONS: { label: string; value: DashboardTimeRangePreset }[] = [
  { label: "Last 1 hour", value: "1h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
];

export function PreferencesSettingsClient({
  initialPreferences,
}: {
  initialPreferences: DashboardPreferences;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(initialPreferences);
  const dirty = useMemo(
    () => !dashboardPreferencesEqual(prefs, initialPreferences),
    [prefs, initialPreferences]
  );

  function save() {
    startTransition(async () => {
      const result = await saveDashboardPreferencesAction(prefs);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Preferences saved");
      setPrefs(result.preferences);
      router.refresh();
    });
  }

  return (
    <>
      <SettingsPageHeader
        title="Preferences"
        description="Defaults for dashboards, lists, and exports."
        actions={
          <SettingsBtn variant="primary" disabled={!dirty || pending} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </SettingsBtn>
        }
      />
      <SettingsPageBody>
        <Section title="Dashboard defaults">
          <FieldGroup>
            <Field label="Default time range">
              <SettingsSelect
                value={prefs.defaultTimeRange}
                onChange={(v) =>
                  setPrefs((current) => ({
                    ...current,
                    defaultTimeRange: v as DashboardTimeRangePreset,
                  }))
                }
                options={TIME_RANGE_OPTIONS}
              />
            </Field>
            <Field label="Compact table density">
              <SettingsToggle
                on={prefs.compactTableDensity}
                onChange={(compactTableDensity) =>
                  setPrefs((current) => ({ ...current, compactTableDensity }))
                }
                label="Use tighter row spacing in lists"
              />
            </Field>
            <Field label="Show resolved issues">
              <SettingsToggle
                on={prefs.showResolvedIssues}
                onChange={(showResolvedIssues) =>
                  setPrefs((current) => ({ ...current, showResolvedIssues }))
                }
                label="Include resolved error groups by default"
              />
            </Field>
          </FieldGroup>
        </Section>
        <Section title="Privacy">
          <FieldGroup>
            <Field label="Usage analytics">
              <SettingsToggle
                on={prefs.usageAnalytics}
                onChange={(usageAnalytics) =>
                  setPrefs((current) => ({ ...current, usageAnalytics }))
                }
                label="Help improve Telemetry Tracker with anonymous usage data"
              />
            </Field>
          </FieldGroup>
        </Section>
      </SettingsPageBody>
    </>
  );
}
