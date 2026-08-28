/** Client-side types + Markdown view for telemetry-tracker.issue.v1 exports. */

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
