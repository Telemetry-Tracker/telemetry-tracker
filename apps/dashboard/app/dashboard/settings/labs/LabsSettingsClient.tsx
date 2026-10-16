"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveLabsPreferencesAction } from "@/app/dashboard/actions";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import { ComingSoonBadge } from "@/app/components/dashboard/coming-soon-ui";
import { Section, SettingsPill, SettingsToggle } from "@/app/components/dashboard/settings/settings-ui";
import type { LabsPreferences } from "@/lib/labs-preferences-shared";

type LabFlag = {
  id: keyof LabsPreferences | "traces" | "alerts";
  label: string;
  desc: string;
  available: boolean;
};

const LAB_FLAGS: LabFlag[] = [
  {
    id: "commandPalette",
    label: "Command palette",
    desc: "Global ⌘K navigation across dashboard pages and actions.",
    available: true,
  },
  {
    id: "traces",
    label: "Traces view",
    desc: "Distributed tracing UI for request flows.",
    available: false,
  },
  {
    id: "alerts",
    label: "Alert rules",
    desc: "Threshold-based alerting for error and usage signals.",
    available: false,
  },
];

export function LabsSettingsClient({
  initialPreferences,
}: {
  initialPreferences: LabsPreferences;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(initialPreferences);

  function toggleCommandPalette() {
    const enabled = !prefs.commandPalette;
    const previous = prefs;
    const next = { ...prefs, commandPalette: enabled };
    setPrefs(next);
    startTransition(async () => {
      const result = await saveLabsPreferencesAction(next);
      if (!result.ok) {
        toast.error(result.error);
        setPrefs(previous);
        return;
      }
      toast.success(enabled ? "Command palette enabled" : "Command palette disabled");
      setPrefs(result.preferences);
      router.refresh();
    });
  }

  return (
    <>
      <SettingsPageHeader
        title="Labs"
        description="Experimental features — may change or be removed."
      />
      <SettingsPageBody>
        <Section
          title="Feature previews"
          description="Per-user toggles apply across every organization you belong to."
        >
          <ul className="divide-y divide-border">
            {LAB_FLAGS.map((flag) => {
              const isCommandPalette = flag.id === "commandPalette";
              const enabled = isCommandPalette ? prefs.commandPalette : false;

              return (
                <li key={flag.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      {flag.label}
                      {flag.available ? (
                        enabled ? (
                          <SettingsPill tone="success">Enabled</SettingsPill>
                        ) : null
                      ) : (
                        <ComingSoonBadge />
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{flag.desc}</div>
                  </div>
                  <SettingsToggle
                    aria-label={flag.label}
                    on={enabled}
                    disabled={!flag.available || pending}
                    onChange={isCommandPalette ? () => toggleCommandPalette() : () => {}}
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      </SettingsPageBody>
    </>
  );
}
