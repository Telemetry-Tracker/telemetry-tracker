"use client";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsBtn } from "@/app/components/dashboard/settings/settings-ui";
import { loadAgentSummary } from "./agent-summary-action";
export function CopyForAgentButton({ issueId }: { issueId: string }) {
  const [pending, setPending] = useState(false);
  return <SettingsBtn type="button" disabled={pending} onClick={async () => {
    setPending(true);
    try {
      const result = await loadAgentSummary(issueId);
      if (!result.text) { toast.error(result.error); return; }
      await navigator.clipboard.writeText(result.text);
      toast.success("Privacy-minimized agent summary copied");
    } catch { toast.error("Could not copy agent summary"); }
    finally { setPending(false); }
  }}>Copy for agent</SettingsBtn>;
}
