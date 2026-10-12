"use server";
import { dashboardApiFetch } from "@/lib/dashboard-api";

export async function checkInAction(method: "GET" | "POST" | "PATCH" | "DELETE", id = "", action = "", body?: unknown) {
  if (id && !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid monitor");
  if (!["", "pause", "resume", "rotate-token", "checkins"].includes(action)) throw new Error("Invalid action");
  const response = await dashboardApiFetch(`/api/project/checkin-monitors${id ? `/${id}` : ""}${action ? `/${action}` : ""}`, {
    method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Check-in request failed");
  return data;
}
