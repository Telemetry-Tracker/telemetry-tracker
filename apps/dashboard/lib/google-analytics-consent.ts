/** Client-only GA4 consent helpers: stop collection immediately on reject / withdrawal (no reload). */

import { clearQaVisitFlag } from "@/lib/qa-visit";

type GaWindow = Record<string, unknown> & { gtag?: (...args: unknown[]) => void };

export function gaDisableKey(measurementId: string): string {
  return `ga-disable-${measurementId}`;
}

/** Delete `_ga`, `_ga_*` and the QA marker `qa` cookies on this host and every parent domain. */
export function clearGoogleAnalyticsCookies(): void {
  if (typeof document === "undefined") return;
  const parts = window.location.hostname.split(".");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (!name || (name !== "_ga" && !name.startsWith("_ga_") && name !== "qa")) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/`;
    for (let i = 0; i < parts.length; i++) {
      const domain = parts.slice(i).join(".");
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}`;
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${domain}`;
    }
  }
}

/** Reject / withdraw: disable the tag, deny analytics storage, delete GA + QA cookies and the tab QA flag. */
export function disableGoogleAnalytics(measurementId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as GaWindow;
  if (measurementId) w[gaDisableKey(measurementId)] = true;
  w.gtag?.("consent", "update", { analytics_storage: "denied" });
  clearGoogleAnalyticsCookies();
  clearQaVisitFlag();
}

/** Accept (incl. after an earlier withdrawal on the same page): re-enable the tag. */
export function enableGoogleAnalytics(measurementId: string | null | undefined): void {
  if (typeof window === "undefined" || !measurementId) return;
  const w = window as unknown as GaWindow;
  const wasDisabled = w[gaDisableKey(measurementId)] === true;
  w[gaDisableKey(measurementId)] = false;
  if (wasDisabled) w.gtag?.("consent", "update", { analytics_storage: "granted" });
}
