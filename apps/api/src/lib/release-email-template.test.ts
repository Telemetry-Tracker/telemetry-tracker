import { describe, expect, it } from "vitest";
import {
  appendReleaseEmailFooter,
  buildReleaseEmailBodyHtml,
  changelogMarkdownToHtml,
  parseInlineMarkdown,
  resolveChangelogLink,
} from "./release-email-template.js";

const ORIGIN = "https://telemetry-tracker.com";

describe("resolveChangelogLink", () => {
  it("keeps absolute URLs unchanged", () => {
    expect(resolveChangelogLink("https://github.com/foo/issues/1", ORIGIN)).toBe(
      "https://github.com/foo/issues/1"
    );
  });

  it("maps repo markdown docs to GitHub blob URLs", () => {
    expect(resolveChangelogLink("docs/RELEASE.md", ORIGIN)).toBe(
      "https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/RELEASE.md"
    );
    expect(resolveChangelogLink("docs/sdk-vite.md", ORIGIN)).toBe(
      "https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/sdk-vite.md"
    );
  });

  it("preserves hash fragments on relative docs links", () => {
    expect(resolveChangelogLink("docs/RELEASE.md#v100-2026-06-26", ORIGIN)).toBe(
      "https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/RELEASE.md#v100-2026-06-26"
    );
  });

  it("resolves site-root paths against dashboard origin", () => {
    expect(resolveChangelogLink("/docs/releases", ORIGIN)).toBe(
      "https://telemetry-tracker.com/docs/releases"
    );
  });

  it("rejects dangerous absolute schemes", () => {
    expect(resolveChangelogLink("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(resolveChangelogLink("data:text/html,test", ORIGIN)).toBeNull();
  });

  it("allows mailto links", () => {
    expect(resolveChangelogLink("mailto:support@example.com", ORIGIN)).toBe(
      "mailto:support@example.com"
    );
  });
});

describe("parseInlineMarkdown", () => {
  it("renders bold without literal asterisks", () => {
    expect(parseInlineMarkdown("**Analytics lists** — faster tables", ORIGIN)).toContain(
      "<strong"
    );
    expect(parseInlineMarkdown("**Analytics lists** — faster tables", ORIGIN)).not.toContain("**");
  });

  it("renders markdown links", () => {
    const html = parseInlineMarkdown(
      "See [#418](https://github.com/example/issues/418)",
      ORIGIN
    );
    expect(html).toContain('href="https://github.com/example/issues/418"');
    expect(html).toContain("#418");
  });

  it("resolves relative markdown links", () => {
    const html = parseInlineMarkdown("See [RELEASE.md](docs/RELEASE.md)", ORIGIN);
    expect(html).toContain(
      'href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/RELEASE.md"'
    );
  });

  it("renders unsafe link labels as plain text", () => {
    const html = parseInlineMarkdown("[click me](javascript:alert(1))", ORIGIN);
    expect(html).not.toContain("<a ");
    expect(html).toContain("click me");
    expect(html).not.toContain("javascript:");
  });
});

describe("changelogMarkdownToHtml", () => {
  it("groups list items and section headings", () => {
    const html = changelogMarkdownToHtml(`### Added

- **Feature A** — detail
- **Feature B** — detail`, ORIGIN);
    expect(html).toContain("Added");
    expect(html).toContain("<ul");
    expect(html).toContain("Feature A");
    expect(html).not.toContain("**Feature");
  });
});

describe("buildReleaseEmailBodyHtml", () => {
  it("includes branded shell and CTA buttons", () => {
    const html = buildReleaseEmailBodyHtml({
      version: "1.9.0",
      sectionMarkdown: "### Added\n\n- **Lists** — sort client-side",
      dashboardOrigin: "https://telemetry-tracker.com",
    });
    expect(html).toContain("Telemetry");
    expect(html).toContain("Tracker");
    expect(html).toContain("v1.9.0");
    expect(html).toContain("Release notes");
    expect(html).toContain("Open dashboard");
    expect(html).toContain('src="cid:tt-brand-logo"');
    expect(html).not.toContain("telemetry-logo.jpg");
    expect(html).not.toContain("linear-gradient");
    expect(html).toContain(
      '<span style="color:#1c1f28;background-color:#f0f2f7;">Telemetry</span>'
    );
    expect(html).toContain("background-color:#eef1ff;color:#4a5fe8");
    expect(html).toContain("background-color:#1c1f28;color:#ffffff");
    expect(html).toContain("background-color:#ffffff;color:#1c1f28");
    expect(html).toContain('name="supported-color-schemes" content="light"');
  });
});

describe("appendReleaseEmailFooter", () => {
  it("adds unsubscribe link", () => {
    const html = appendReleaseEmailFooter(
      buildReleaseEmailBodyHtml({
        version: "1.9.0",
        sectionMarkdown: "### Added\n\n- Item",
        dashboardOrigin: "https://telemetry-tracker.com",
      }),
      "https://telemetry-tracker.com/unsubscribe?token=abc"
    );
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("token=abc");
  });
});
