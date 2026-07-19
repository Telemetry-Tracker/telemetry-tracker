import { describe, expect, it } from "vitest";
import {
  ISSUE_EXPORT_SCHEMA,
  buildIssueExportDocument,
  issueExportToMarkdown,
  type IssueExportSource,
} from "./issue-export.js";

function baseSource(
  overrides: Partial<IssueExportSource> = {}
): IssueExportSource {
  return {
    telemetryTrackerVersion: "1.17.3",
    exportedAt: new Date("2026-07-19T12:00:00.000Z"),
    projectName: "production-api",
    issue: {
      id: "err-1",
      message: "TypeError: boom for user@example.com",
      fingerprint: "fp-1",
      app: "web",
      environment: "production",
      platform: "javascript",
      release: "1.2.3",
      occurrences: 42,
      users_affected: 12,
      sessions_affected: 18,
      first_seen: new Date("2026-07-01T00:00:00.000Z"),
      last_seen: new Date("2026-07-19T11:00:00.000Z"),
      resolved_at: null,
      top_stack: "at foo (app.js:1:1)",
      symbolicated_top_stack: "at foo (src/app.ts:10:5)",
      tags: {},
    },
    latestOccurrence: {
      id: "occ-1",
      created_at: new Date("2026-07-19T11:00:00.000Z"),
      stack: "Error: boom\n    at foo",
      symbolicated_stack: "Error: boom\n    at foo (src/app.ts:10:5)",
      context: { email: "user@example.com", path: "/checkout" },
      user_id: "u-1",
      session_id: "s-1",
      release: "1.2.3",
      sdk_version: "0.9.0",
    },
    dashboardUrl: "https://app.example.com/dashboard/errors/err-1",
    ...overrides,
  };
}

describe("buildIssueExportDocument", () => {
  it("builds a versioned telemetry-tracker.issue.v1 document", () => {
    const doc = buildIssueExportDocument(baseSource());
    expect(doc.schema).toBe(ISSUE_EXPORT_SCHEMA);
    expect(doc.telemetry_tracker_version).toBe("1.17.3");
    expect(doc.exported_at).toBe("2026-07-19T12:00:00.000Z");
    expect(doc.project).toEqual({ name: "production-api" });
    expect(doc.project).not.toHaveProperty("id");
    expect(doc.issue.id).toBe("err-1");
    expect(doc.issue.tags).toEqual({});
    expect(doc.latest_occurrence?.id).toBe("occ-1");
    expect(doc.dashboard_url).toContain("/dashboard/errors/err-1");
  });

  it("allows latest_occurrence to be null", () => {
    const doc = buildIssueExportDocument(
      baseSource({ latestOccurrence: null })
    );
    expect(doc.latest_occurrence).toBeNull();
    expect(doc.issue.message).toContain("[email]");
  });

  it("scrubs PII in message, stacks, and context", () => {
    const doc = buildIssueExportDocument(baseSource());
    expect(doc.issue.message).toBe("TypeError: boom for [email]");
    expect(doc.latest_occurrence?.context).toMatchObject({
      email: "[email]",
      path: "/checkout",
    });
  });

  it("applies project denyKeys to context", () => {
    const doc = buildIssueExportDocument(
      baseSource({
        scrubOptions: { denyKeys: ["path"] },
      })
    );
    expect(doc.latest_occurrence?.context).toMatchObject({
      path: "[redacted]",
    });
  });
});

describe("issueExportToMarkdown", () => {
  it("renders a readable summary from the same document", () => {
    const doc = buildIssueExportDocument(baseSource());
    const md = issueExportToMarkdown(doc);
    expect(md).toContain("## TypeError: boom for [email]");
    expect(md).toContain("**Occurrences:** 42");
    expect(md).toContain("**Telemetry Tracker:** 1.17.3");
    expect(md).toContain("### Stack");
    expect(md).toContain("[View in Telemetry Tracker]");
  });

  it("notes missing occurrences instead of failing", () => {
    const doc = buildIssueExportDocument(
      baseSource({
        latestOccurrence: null,
        issue: {
          ...baseSource().issue,
          top_stack: null,
          symbolicated_top_stack: null,
        },
      })
    );
    const md = issueExportToMarkdown(doc);
    expect(md).toContain("No occurrence available");
  });
});
