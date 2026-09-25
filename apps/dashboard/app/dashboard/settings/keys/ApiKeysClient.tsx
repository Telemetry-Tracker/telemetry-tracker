"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createDashboardApiKey,
  revokeDashboardApiKey,
} from "@/app/dashboard/actions";
import { ApiKeysEmptyState } from "./ApiKeysEmptyState";
import { useDashboardCapabilities } from "@/app/components/dashboard/DashboardCapabilitiesContext";
import {
  Section,
  SettingsBtn,
  SettingsInput,
  SettingsPill,
} from "@/app/components/dashboard/settings/settings-ui";
import { Table, TableWrap, tableDateColumnClass } from "@/app/components/ui/Table";
import { TimeAgo } from "@/app/components/TimeAgo";
import { toast } from "sonner";

export type ApiKeyRow = {
  publicId: string;
  name: string | null;
  allowedApp: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function ApiKeysClient({ keys }: { keys: ApiKeyRow[] }) {
  const caps = useDashboardCapabilities();
  const permUnknown = caps === null;
  const canCreateApiKey = caps?.canCreateApiKey === true || permUnknown;
  const canRevokeApiKey = caps?.canRevokeApiKey === true || permUnknown;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revokePending, setRevokePending] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  function onCreate(formData: FormData) {
    setFormError(null);
    startTransition(async () => {
      const r = await createDashboardApiKey(null, formData);
      if (r.ok) {
        setNewKey(r.key);
        router.refresh();
      } else {
        setFormError(r.error);
      }
    });
  }

  async function onRevoke(publicId: string) {
    if (!confirm("Revoke this key? SDKs using it will stop working.")) return;
    setRevokePending(publicId);
    const r = await revokeDashboardApiKey(publicId);
    setRevokePending(null);
    if (!r.ok) {
      toast.error(r.error);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {keys.length === 0 ? (
        <ApiKeysEmptyState
          canCreate={canCreateApiKey}
          onCreated={(key) => setNewKey(key)}
        />
      ) : null}

      {newKey ? (
        <Section title="New key — copy now">
          <p className="mb-3 text-[13px] text-muted-foreground">
            This secret is shown only once. Store it in an environment variable or secret manager.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 truncate rounded-md border border-border bg-background/80 px-3 py-2 font-mono text-[12px]">
              {newKey}
            </code>
            <SettingsBtn
              type="button"
              variant="default"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newKey);
                  toast.success("Copied to clipboard");
                } catch {
                  toast.error("Could not copy to clipboard.");
                }
              }}
            >
              Copy
            </SettingsBtn>
            <SettingsBtn type="button" variant="ghost" onClick={() => setNewKey(null)}>
              Done
            </SettingsBtn>
          </div>
        </Section>
      ) : null}

      {permUnknown ? (
        <p
          className="rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-foreground"
          role="status"
        >
          Workspace permissions did not load. Create and revoke are still available; the server will
          reject actions your account is not allowed to perform.
        </p>
      ) : null}

      {canCreateApiKey ? (
        <Section title="Create key">
          <form action={onCreate} className="flex max-w-md flex-col gap-3">
            <label className="text-[13px] text-muted-foreground" htmlFor="key-name">
              Label <span className="text-muted-foreground">(optional)</span>
            </label>
            <SettingsInput
              id="key-name"
              name="name"
              type="text"
              placeholder="e.g. production CI"
              maxLength={120}
              autoComplete="off"
              disabled={pending}
            />
            <label className="text-[13px] text-muted-foreground" htmlFor="key-allowed-app">
              Restrict to app <span className="text-muted-foreground">(optional)</span>
            </label>
            <SettingsInput
              id="key-allowed-app"
              name="allowedApp"
              type="text"
              placeholder="e.g. my-ios-app"
              maxLength={64}
              autoComplete="off"
              disabled={pending}
            />
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-[13px] text-muted-foreground" htmlFor="key-source-maps">
              <input
                id="key-source-maps"
                name="sourceMapUpload"
                type="checkbox"
                className="mt-0.5"
                disabled={pending}
              />
              <span>
                Allow source map uploads. Use this only for CI. Leave it off for keys embedded in
                client apps.
              </span>
            </label>
            <SettingsBtn type="submit" variant="primary" disabled={pending}>
              {pending ? "Creating…" : "Create API key"}
            </SettingsBtn>
          </form>
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to create API keys. Ask an organization owner or editor.
        </p>
      )}

      <Section title="Keys for this project">
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canCreateApiKey
              ? "Use the button above or the form below to create your first key."
              : "No keys for this project yet."}
          </p>
        ) : (
          <TableWrap className="border-0 bg-transparent">
            <Table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th className="hidden md:table-cell">Allowed app</th>
                  <th className="hidden lg:table-cell">Public id</th>
                  <th className={tableDateColumnClass}>Created</th>
                  <th className={`hidden sm:table-cell ${tableDateColumnClass}`}>Last used</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const revoked = Boolean(k.revokedAt);
                  return (
                    <tr key={k.publicId}>
                      <td>{k.name ?? "—"}</td>
                      <td className="hidden md:table-cell">{k.allowedApp ?? "—"}</td>
                      <td className="hidden lg:table-cell">
                        <code className="font-mono text-[11px]">{k.publicId}</code>
                      </td>
                      <td className={tableDateColumnClass}>
                        <TimeAgo iso={k.createdAt} />
                      </td>
                      <td className={`hidden sm:table-cell ${tableDateColumnClass}`}>
                        {k.lastUsedAt ? <TimeAgo iso={k.lastUsedAt} /> : "—"}
                      </td>
                      <td>
                        {revoked ? (
                          <SettingsPill tone="muted">Revoked</SettingsPill>
                        ) : (
                          <SettingsPill tone="success">Active</SettingsPill>
                        )}
                      </td>
                      <td>
                        {!revoked && canRevokeApiKey ? (
                          <SettingsBtn
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={revokePending === k.publicId}
                            onClick={() => onRevoke(k.publicId)}
                          >
                            {revokePending === k.publicId ? "…" : "Revoke"}
                          </SettingsBtn>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
