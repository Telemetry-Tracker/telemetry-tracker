import { dashboardApiFetch } from "@/lib/dashboard-api";
import {
  parseProjectAlertSettings,
  type AlertEventRow,
  type ProjectAlertSettings,
} from "@/lib/alert-settings";

function isEvent(value: unknown): value is AlertEventRow {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    (o.rule === "CHECKIN_DOWN" || o.rule === "CHECKIN_RECOVERED" || o.rule === "ERROR_SPIKE" ||
      o.rule === "QUOTA_NEAR" ||
      o.rule === "QUOTA_EXCEEDED" ||
      o.rule === "ALERT_RULE") &&
    typeof o.title === "string" &&
    typeof o.body === "string" &&
    typeof o.firedAt === "string" &&
    (o.href === null || typeof o.href === "string")
  );
}

export async function fetchProjectAlertSettings(): Promise<ProjectAlertSettings> {
  const res = await dashboardApiFetch("/api/project/alert-settings");
  if (!res.ok) return parseProjectAlertSettings(null);
  try {
    const data = (await res.json()) as { settings?: unknown };
    return parseProjectAlertSettings(data.settings);
  } catch {
    return parseProjectAlertSettings(null);
  }
}

export async function fetchProjectAlertEvents(): Promise<AlertEventRow[]> {
  const res = await dashboardApiFetch("/api/project/alert-events?limit=25");
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as { events?: unknown };
    if (!Array.isArray(data.events)) return [];
    return data.events.filter(isEvent);
  } catch {
    return [];
  }
}
