"use server";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import { parseDashboardApiResourceId } from "@/lib/dashboard-api-url";

export async function checkInAction(method: "GET" | "POST" | "PATCH" | "DELETE", id = "", action = "", body?: unknown) {
  const monitorId = id ? parseDashboardApiResourceId(id) : null;
  if (id && !monitorId) throw new Error("Invalid monitor");
  let suffix: string;
  switch (action) {
    case "": suffix = ""; break;
    case "pause": suffix = "/pause"; break;
    case "resume": suffix = "/resume"; break;
    case "rotate-token": suffix = "/rotate-token"; break;
    case "checkins": suffix = "/checkins"; break;
    default: throw new Error("Invalid action");
  }
  if (suffix && !monitorId) throw new Error("Invalid monitor");
  const response = await dashboardApiFetch(`/api/project/checkin-monitors${monitorId ? `/${encodeURIComponent(monitorId)}` : ""}${suffix}`, {
    method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Check-in request failed");
  return data;
}
