"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import { Section, SettingsPill } from "@/app/components/dashboard/settings/settings-ui";

type ThemeId = "dark" | "light" | "system";

const THEMES: {
  id: ThemeId;
  label: string;
  desc: string;
  icon: LucideIcon;
}[] = [
  { id: "dark", label: "Dark", desc: "Pure black canvas — default", icon: Moon },
  { id: "light", label: "Light", desc: "Bright workspace for daytime use", icon: Sun },
  { id: "system", label: "System", desc: "Follow your device appearance", icon: Monitor },
];

export function AppearanceSettingsClient() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const active = mounted ? ((theme ?? "dark") as ThemeId) : null;

  return (
    <>
      <SettingsPageHeader
        title="Appearance"
        description="Visual preferences for the dashboard."
      />
      <SettingsPageBody>
        <Section title="Theme">
          <div 
            role="radiogroup" 
            aria-label="Theme"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {THEMES.map((t) => {
              const Icon = t.icon;
              const selected = active !== null && active === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!mounted}
                  onClick={() => setTheme(t.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-brand bg-brand-soft/30"
                      : "border-border bg-surface/40 hover:border-border-strong hover:bg-surface/60"
                  } ${!mounted ? "opacity-70" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {t.label}
                    </span>
                    {selected ? <SettingsPill tone="brand">Active</SettingsPill> : null}
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">{t.desc}</p>
                </button>
              );
            })}
          </div>
          {mounted && resolvedTheme ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Currently showing the {resolvedTheme} palette
              {active === "system" ? " (from system preference)" : ""}.
            </p>
          ) : null}
        </Section>
        <Section title="Density">
          <p className="text-[13px] text-muted-foreground">
            Compact and comfortable density options are planned for a future release. Theme
            preference is saved in this browser automatically.
          </p>
        </Section>
      </SettingsPageBody>
    </>
  );
}
