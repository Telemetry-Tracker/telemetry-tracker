/**
 * Stable developer/AI export contract for a single error issue.
 * Schema: telemetry-tracker.issue.v1
 */

import { scrubPiiRecord, scrubPiiText, type PiiScrubOptions } from "./pii-scrub.js";

export const ISSUE_EXPORT_SCHEMA = "telemetry-tracker.issue.v1" as const;

export type IssueExportV1 = {
  schema: typeof ISSUE_EXPORT_SCHEMA;
  telemetry_tracker_version: string;
  exported_at: string;
  project: { name: string };
  issue: {
    id: string;
    message: string;
    fingerprint: string | null;
    app: string;
    environment: string | null;
    platform: string | null;
    release: string | null;
    occurrences: number;
    users_affected: number | null;
    sessions_affected: number | null;
    first_seen: string | null;
    last_seen: string | null;
    resolved_at: string | null;
    top_stack: string | null;
    symbolicated_top_stack: string | null;
    /** Reserved for future diagnosis metadata (may be empty). */
    tags: Record<string, string>;
  };
  latest_occurrence: {
    id: string;
    created_at: string;
    stack: string | null;
    symbolicated_stack: string | null;
    context: Record<string, unknown> | null;
    user_id: string | null;
    session_id: string | null;
    release: string | null;
    sdk_version: string | null;
  } | null;
  dashboard_url: string | null;
};

export type IssueExportSource = {
  telemetryTrackerVersion: string;
  exportedAt?: Date;
  projectName: string;
  issue: {
    id: string;
    message: string;
    fingerprint: string | null;
    app: string;
    environment: string | null;
    platform: string | null;
    release: string | null;
    occurrences: number;
    users_affected?: number | null;
    sessions_affected?: number | null;
    first_seen: Date | string | null;
    last_seen: Date | string | null;
    resolved_at: Date | string | null;
    top_stack: string | null;
    symbolicated_top_stack?: string | null;
    tags?: Record<string, string>;
  };
  latestOccurrence: {
    id: string;
    created_at: Date | string;
    stack: string | null;
    symbolicated_stack?: string | null;
    context?: unknown;
    user_id?: string | null;
    session_id?: string | null;
    release?: string | null;
    sdk_version?: string | null;
  } | null;
  dashboardUrl: string | null;
  scrubOptions?: PiiScrubOptions;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asContextRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function scrubNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return scrubPiiText(value);
}

/** Build a versioned issue export document (PII-scrubbed). */
export function buildIssueExportDocument(source: IssueExportSource): IssueExportV1 {
  const scrub = source.scrubOptions;
  const occ = source.latestOccurrence;
  let context: Record<string, unknown> | null = asContextRecord(occ?.context);
  if (context) {
    context = scrubPiiRecord(context, scrub) ?? null;
  }

  return {
    schema: ISSUE_EXPORT_SCHEMA,
    telemetry_tracker_version: source.telemetryTrackerVersion,
    exported_at: (source.exportedAt ?? new Date()).toISOString(),
    project: { name: source.projectName },
    issue: {
      id: source.issue.id,
      message: scrubPiiText(source.issue.message),
      fingerprint: source.issue.fingerprint,
      app: source.issue.app,
      environment: source.issue.environment,
      platform: source.issue.platform,
      release: source.issue.release,
      occurrences: source.issue.occurrences,
      users_affected: source.issue.users_affected ?? null,
      sessions_affected: source.issue.sessions_affected ?? null,
      first_seen: toIso(source.issue.first_seen),
      last_seen: toIso(source.issue.last_seen),
      resolved_at: toIso(source.issue.resolved_at),
      top_stack: scrubNullableText(source.issue.top_stack),
      symbolicated_top_stack: scrubNullableText(
        source.issue.symbolicated_top_stack ?? null
      ),
      tags: source.issue.tags ?? {},
    },
    latest_occurrence: occ
      ? {
          id: occ.id,
          created_at: toIso(occ.created_at) ?? new Date(0).toISOString(),
          stack: scrubNullableText(occ.stack),
          symbolicated_stack: scrubNullableText(occ.symbolicated_stack ?? null),
          context,
          user_id: occ.user_id ?? null,
          session_id: occ.session_id ?? null,
          release: occ.release ?? null,
          sdk_version: occ.sdk_version ?? null,
        }
      : null,
    dashboard_url: source.dashboardUrl,
  };
}

/** Markdown view of the same export document (for Copy as Markdown). */
export function issueExportToMarkdown(doc: IssueExportV1): string {
  const lines: string[] = [];
  lines.push(`## ${doc.issue.message}`);
  lines.push("");
  const counts = [
    `**Occurrences:** ${doc.issue.occurrences}`,
    doc.issue.users_affected != null ? `**Users:** ${doc.issue.users_affected}` : null,
    doc.issue.sessions_affected != null
      ? `**Sessions:** ${doc.issue.sessions_affected}`
      : null,
  ].filter(Boolean);
  if (counts.length) lines.push(`- ${counts.join(" · ")}`);

  const scope = [
    doc.issue.app ? `**App:** ${doc.issue.app}` : null,
    doc.issue.environment ? `**Env:** ${doc.issue.environment}` : null,
    doc.issue.release ? `**Release:** ${doc.issue.release}` : null,
    doc.issue.platform ? `**Platform:** ${doc.issue.platform}` : null,
  ].filter(Boolean);
  if (scope.length) lines.push(`- ${scope.join(" · ")}`);

  if (doc.issue.first_seen || doc.issue.last_seen) {
    lines.push(
      `- **First / last seen:** ${doc.issue.first_seen ?? "—"} / ${doc.issue.last_seen ?? "—"}`
    );
  }
  lines.push(`- **Telemetry Tracker:** ${doc.telemetry_tracker_version}`);
  if (doc.project.name) {
    lines.push(`- **Project:** ${doc.project.name}`);
  }

  const stack =
    doc.latest_occurrence?.symbolicated_stack ||
    doc.latest_occurrence?.stack ||
    doc.issue.symbolicated_top_stack ||
    doc.issue.top_stack;

  lines.push("");
  if (stack) {
    lines.push("### Stack");
    lines.push("");
    lines.push("```");
    lines.push(stack);
    lines.push("```");
    lines.push("");
  } else if (!doc.latest_occurrence) {
    lines.push("_No occurrence available to export (e.g. retention)._");
    lines.push("");
  }

  if (doc.dashboard_url) {
    lines.push(`[View in Telemetry Tracker](${doc.dashboard_url})`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
