"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  listProjectSourceMapsAction,
  type SourceMapArtifactSummaryRow,
} from "@/app/dashboard/actions";
import { EmptyState } from "@/app/components/EmptyState";
import { ErrorState } from "@/app/components/ErrorState";
import { Field } from "@/app/components/dashboard/settings/settings-ui";

type ArtifactRow = SourceMapArtifactSummaryRow;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SourceMapsSettingsClient({
  projectId,
  initialApp,
  initialRelease,
}: {
  projectId?: string;
  initialApp: string;
  initialRelease: string;
}) {
  const [app, setApp] = useState(initialApp);
  const [release, setRelease] = useState(initialRelease);
  const [artifacts, setArtifacts] = useState<ArtifactRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const appLabel = app.trim();
    const releaseLabel = release.trim();
    if (!appLabel || !releaseLabel) {
      setError("Enter both app and release to list uploaded maps.");
      setArtifacts(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await listProjectSourceMapsAction(appLabel, releaseLabel);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setArtifacts(result.artifacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setArtifacts(null);
    } finally {
      setLoading(false);
    }
  }, [app, release]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Source maps are keyed by app, release, and bundle URL. Upload them from CI with a project
        API key that has source map upload enabled. See{" "}
        <Link href="/docs/source-maps" className="text-brand hover:underline">
          Source maps docs
        </Link>{" "}
        for the GitHub Action and Next.js setup.
      </p>
      {projectId ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Project ID</span>
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">{projectId}</code>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-surface-elevated"
            aria-label="Copy project ID"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(projectId);
                toast.success("Project ID copied");
              } catch {
                toast.error("Could not copy project ID.");
              }
            }}
          >
            Copy
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="App">
          <input
            id="source-maps-app"
            aria-label="App"
            value={app}
            onChange={(e) => setApp(e.target.value)}
            placeholder="web"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Release">
          <input
            id="source-maps-release"
            aria-label="Release"
            value={release}
            onChange={(e) => setRelease(e.target.value)}
            placeholder="1.0.0"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Loading…" : "List maps"}
      </button>

      {error ? <ErrorState message={error} /> : null}

      {artifacts !== null && artifacts.length === 0 ? (
        <EmptyState
          title="No maps for this release"
          message="Upload source maps for this app and release to enable symbolicated stack traces on error detail."
        />
      ) : null}

      {artifacts && artifacts.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-surface/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Bundle</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">SHA-256</th>
                <th className="px-4 py-2 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((row) => (
                <tr key={row.id} className="border-b border-border/50 last:border-0">
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-xs" title={row.bundleUrl}>
                    {row.bundleUrl}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatBytes(row.sizeBytes)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {row.sha256.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(row.uploadedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
