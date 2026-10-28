"use server";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import { revalidatePath } from "next/cache";
export async function createAgentToken(data: { name: string; projectIds: string[]; expiryDays: number }): Promise<{ token?: string; error?: string }> {
  const res = await dashboardApiFetch("/api/project/agent-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) return { error: "Could not create token. Check your permissions, selected projects and expiry." };
  const result = await res.json() as { token: string };
  revalidatePath("/dashboard/settings/agent-access");
  return { token: result.token };
}
export async function revokeAgentToken(id: string): Promise<{ error?: string }> {
  const res = await dashboardApiFetch(`/api/project/agent-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return { error: "Could not revoke token." };
  revalidatePath("/dashboard/settings/agent-access");
  return {};
}
