"use server";
import { dashboardApiFetch } from "@/lib/dashboard-api";
export async function loadAgentSummary(id: string): Promise<{ text?: string; error?: string }> {
  const response = await dashboardApiFetch(`/api/project/agent-summary/${encodeURIComponent(id)}`);
  if (!response.ok) return { error: "Agent summary unavailable. MCP and PII scrubbing must be enabled by the operator." };
  return { text: JSON.stringify(await response.json(), null, 2) };
}
