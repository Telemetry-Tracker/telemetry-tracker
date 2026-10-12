import { dashboardApiFetch } from "@/lib/dashboard-api";
import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { AgentTokensClient, type AgentTokensData } from "./AgentTokensClient";
export const dynamic = "force-dynamic";
export default async function AgentAccessPage() {
  const response = await dashboardApiFetch("/api/project/agent-tokens");
  return <>
    <SettingsPageHeader title="Agent access" description="Read-only, expiring tokens for explicitly selected projects in this organization." />
    {response.ok ? <AgentTokensClient data={await response.json() as AgentTokensData} /> : <p>Agent access is disabled or unavailable to your account. Owners and editors can create tokens when the operator enables MCP and PII scrubbing.</p>}
  </>;
}
