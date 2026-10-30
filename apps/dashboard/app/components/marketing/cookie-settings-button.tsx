"use client";

import { openCookieSettings } from "@/lib/cookie-consent";

type CookieSettingsButtonProps = { className?: string };

/** Reopens the cookie banner so visitors can change or withdraw consent at any time. */
export function CookieSettingsButton({ className }: CookieSettingsButtonProps) {
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      className={className ?? "text-sm text-foreground/85 hover:text-foreground"}
    >
      Cookie settings
    </button>
  );
}
