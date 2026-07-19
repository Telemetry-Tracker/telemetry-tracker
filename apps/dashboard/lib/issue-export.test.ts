import { describe, expect, it } from "vitest";
import {
  ISSUE_EXPORT_SCHEMA,
  issueExportToMarkdown,
  type IssueExportV1,
} from "./issue-export";

const sample: IssueExportV1 = {
  schema: ISSUE_EXPORT_SCHEMA,
  telemetry_tracker_version: "1.17.3",
  exported_at: "2026-07-19T12:00:00.000Z",
  project: { name: "production-api" },
  issue: {
    id: "err-1",
    message: "TypeError: boom",
    fingerprint: "fp-1",
    app: "web",
    environment: "production",
    platform: "javascript",
    release: "1.2.3",
    occurrences: 42,
    users_affected: 12,
    sessions_affected: 18,
    first_seen: "2026-07-01T00:00:00.000Z",
    last_seen: "2026-07-19T11:00:00.000Z",
    resolved_at: null,
    top_stack: null,
    symbolicated_top_stack: null,
    tags: {},
  },
  latest_occurrence: null,
  dashboard_url: "https://app.example.com/dashboard/errors/err-1",
};

describe("issueExportToMarkdown", () => {
  it("renders summary with missing occurrence note", () => {
    const md = issueExportToMarkdown(sample);
    expect(md).toContain("## TypeError: boom");
    expect(md).toContain("**Telemetry Tracker:** 1.17.3");
    expect(md).toContain("No occurrence available");
    expect(md).toContain("[View in Telemetry Tracker]");
  });
});
