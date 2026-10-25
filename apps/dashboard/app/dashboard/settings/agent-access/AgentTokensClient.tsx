"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section, SettingsBtn, SettingsInput } from "@/app/components/dashboard/settings/settings-ui";
import { createAgentToken, revokeAgentToken } from "./actions";
export type AgentTokensData = {
  projects: { id: string; name: string }[]; defaultProjectId: string;
  tokens: { id: string; name: string; project_ids: string[]; expires_at: string; revoked_at: string | null; last_used_at: string | null; usage_count: number; last_tool: string | null }[];
};
export function AgentTokensClient({ data }: { data: AgentTokensData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">Data retrieved by your agent may be sent to the AI provider you choose. <Link href="/docs/mcp" className="underline">Setup and security guide</Link>.</p>
    {secret && <Section title="Copy your token now — shown once">
      <code className="block break-all rounded border border-border p-3">{secret}</code>
      <SettingsBtn type="button" onClick={async () => { try { await navigator.clipboard.writeText(secret); } catch { setError("Clipboard unavailable. Select and copy the token."); } }}>Copy</SettingsBtn>
      <SettingsBtn type="button" onClick={() => setSecret(undefined)}>Done</SettingsBtn>
    </Section>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Section title="Create read token">
      <form className="flex max-w-lg flex-col gap-3" action={(form) => startTransition(async () => {
        setError(undefined);
        const result = await createAgentToken({ name: String(form.get("name") ?? ""), projectIds: form.getAll("projects").map(String), expiryDays: Number(form.get("days")) });
        setSecret(result.token); setError(result.error); router.refresh();
      })}>
        <label htmlFor="agent-token-name">Name</label><SettingsInput id="agent-token-name" name="name" required maxLength={120} disabled={pending} />
        <fieldset disabled={pending}><legend>Select projects (one selected by default)</legend>
          {data.projects.map((p) => <label key={p.id} className="block"><input type="checkbox" name="projects" value={p.id} defaultChecked={p.id === data.defaultProjectId} /> {p.name}</label>)}
        </fieldset>
        <label htmlFor="agent-token-days">Expires after days (maximum 365)</label><SettingsInput id="agent-token-days" name="days" type="number" defaultValue={90} min={1} max={365} required disabled={pending} />
        <SettingsBtn type="submit" disabled={pending}>Create token</SettingsBtn>
      </form>
    </Section>
    <Section title="Read tokens">
      <ul className="space-y-4">{data.tokens.map((t) => <li key={t.id} className="rounded border border-border p-3 text-sm">
        <strong>{t.name}</strong><p>Projects: {t.project_ids.map((id) => data.projects.find((p) => p.id === id)?.name ?? "Unavailable project").join(", ")}</p>
        <p>Expires: {new Date(t.expires_at).toLocaleString()} · Last used: {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "Never"}</p>
        <p>Requests: {t.usage_count} · Last tool: {t.last_tool ?? "None"} · {t.revoked_at ? "Revoked" : new Date(t.expires_at) <= new Date() ? "Expired" : "Active"}</p>
        {!t.revoked_at && <SettingsBtn type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await revokeAgentToken(t.id); setError(result.error); router.refresh(); })}>Revoke</SettingsBtn>}
      </li>)}</ul>
    </Section>
  </div>;
}
