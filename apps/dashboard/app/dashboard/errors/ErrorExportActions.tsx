"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsBtn } from "@/app/components/dashboard/settings/settings-ui";
import { dashboardApiClientFetch } from "@/lib/dashboard-api-client";
import {
  issueExportToMarkdown,
  type IssueExportV1,
} from "@/lib/issue-export";

export type ErrorExportScope = {
  app?: string;
  environment?: string;
  platform?: string;
  release?: string;
  range?: string;
  from?: string;
  to?: string;
  metricsUntil?: string;
  metricsSince?: string;
};

function buildExportQuery(scope: ErrorExportScope): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(scope)) {
    if (typeof value === "string" && value.trim()) qs.set(key, value.trim());
  }
  const q = qs.toString();
  return q ? `?${q}` : "";
}

async function fetchIssueExport(
  errorGroupId: string,
  scope: ErrorExportScope
): Promise<IssueExportV1> {
  const res = await dashboardApiClientFetch(
    `/api/errors/${encodeURIComponent(errorGroupId)}/export${buildExportQuery(scope)}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 200) || `Export failed (${res.status})`);
  }
  return (await res.json()) as IssueExportV1;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function downloadJson(doc: IssueExportV1, errorGroupId: string): void {
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `issue-${errorGroupId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ErrorExportActions({
  errorGroupId,
  scope,
}: {
  errorGroupId: string;
  scope: ErrorExportScope;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"json" | "download" | "md" | null>(null);

  const run = useCallback(
    (kind: "json" | "download" | "md", work: (doc: IssueExportV1) => Promise<void> | void) => {
      startTransition(async () => {
        setBusy(kind);
        try {
          const doc = await fetchIssueExport(errorGroupId, scope);
          await work(doc);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Export failed");
        } finally {
          setBusy(null);
        }
      });
    },
    [errorGroupId, scope]
  );

  return (
    <>
      <SettingsBtn
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run("json", async (doc) => {
            await copyText(JSON.stringify(doc, null, 2));
            toast.success("Copied JSON");
          })
        }
      >
        {busy === "json" ? "…" : "Copy JSON"}
      </SettingsBtn>
      <SettingsBtn
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run("download", (doc) => {
            downloadJson(doc, errorGroupId);
            toast.success("Downloaded JSON");
          })
        }
      >
        {busy === "download" ? "…" : "Download JSON"}
      </SettingsBtn>
      <SettingsBtn
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run("md", async (doc) => {
            await copyText(issueExportToMarkdown(doc));
            toast.success("Copied Markdown");
          })
        }
      >
        {busy === "md" ? "…" : "Copy Markdown"}
      </SettingsBtn>
    </>
  );
}
