import { describe, expect, it } from "vitest";
import { renderEmailBrandHeader, renderEmailPrimaryCta } from "./email-chrome.js";

describe("renderEmailBrandHeader", () => {
  it("uses a solid header fill and explicit wordmark colors", () => {
    const html = renderEmailBrandHeader({
      badgeLabel: "New error",
      badgeBackground: "#fdecea",
      badgeColor: "#c0392b",
    });

    expect(html).not.toContain("linear-gradient");
    expect(html).toContain('bgcolor="#f0f2f7"');
    expect(html).toContain("background-color:#f0f2f7");
    expect(html).toContain(
      '<span style="color:#1c1f28;background-color:#f0f2f7;">Telemetry</span>'
    );
    expect(html).toContain(
      '<span style="color:#647089;background-color:#f0f2f7;"> / </span><span style="color:#1c1f28;background-color:#f0f2f7;">Tracker</span>'
    );
    expect(html).toContain("background-color:#fdecea;color:#c0392b");
    expect(html).toContain("New error");
  });

  it("escapes badge text", () => {
    const html = renderEmailBrandHeader({
      badgeLabel: `<img>`,
      badgeBackground: "#eef1ff",
      badgeColor: "#4a5fe8",
    });
    expect(html).toContain("&lt;img&gt;");
    expect(html).not.toContain("<img>");
  });
});

describe("renderEmailPrimaryCta", () => {
  it("sets button fill and label color on the same element", () => {
    const html = renderEmailPrimaryCta("https://example.com/a?b=1", "Open error group");
    expect(html).toContain('href="https://example.com/a?b=1"');
    expect(html).toContain("background-color:#1c1f28;color:#ffffff");
    expect(html).toContain("Open error group");
    expect(html).not.toContain("linear-gradient");
  });
});
