import { describe, expect, it } from "vitest";
import {
  CONNECT_APP_FRAMEWORKS,
  connectAppSnippets,
  frameworkDocsHref,
  frameworkLabel,
} from "./connect-app-setup";

describe("connect-app-setup", () => {
  it("lists frameworks with docs", () => {
    expect(CONNECT_APP_FRAMEWORKS.length).toBeGreaterThan(3);
    expect(frameworkLabel("nextjs")).toBe("Next.js");
    expect(frameworkDocsHref("node")).toBe("/docs/node");
    expect(frameworkDocsHref("unknown")).toBe("/docs/sdk");
  });

  it("embeds app name and key in nextjs snippets", () => {
    const s = connectAppSnippets("nextjs", {
      appName: "storefront",
      apiKey: "tt_live_test_secret",
    });
    expect(s.configure).toContain("storefront");
    expect(s.configure).toContain("tt_live_test_secret");
    expect(s.verify).toContain("app_connected");
  });
});
