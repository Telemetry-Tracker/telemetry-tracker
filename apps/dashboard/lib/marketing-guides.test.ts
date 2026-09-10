import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETING_GUIDE_PATHS } from "./public-seo-paths";
import { marketingGuideMetadata } from "./marketing-guide-metadata";

const appDir = join(import.meta.dirname, "..", "app");

const pageFiles: Record<(typeof MARKETING_GUIDE_PATHS)[number], string> = {
  "/sentry-alternative": "sentry-alternative/page.tsx",
  "/self-hosted-error-tracking": "self-hosted-error-tracking/page.tsx",
  "/error-tracking/nextjs": "error-tracking/nextjs/page.tsx",
  "/error-tracking/react": "error-tracking/react/page.tsx",
  "/error-tracking/nodejs": "error-tracking/nodejs/page.tsx",
  "/error-tracking/react-native": "error-tracking/react-native/page.tsx",
};

describe("marketing guide pages", () => {
  it("each guide has unique copy and no unsupported product claims", () => {
    const titles = new Set<string>();
    for (const path of MARKETING_GUIDE_PATHS) {
      const src = readFileSync(join(appDir, pageFiles[path]), "utf8");
      expect(src).toContain("marketingGuideMetadata");
      expect(src).not.toMatch(/cookies\(/);
      expect(src).not.toMatch(/unlimited free|feature-parity with Sentry/i);
      const titleMatch = src.match(/const TITLE = "([^"]+)"/);
      expect(titleMatch?.[1]).toBeTruthy();
      titles.add(titleMatch![1]!);
    }
    expect(titles.size).toBe(MARKETING_GUIDE_PATHS.length);
  });

  it("emits an absolute title, description, and canonical for a guide path", () => {
    const metadata = marketingGuideMetadata({
      title: "Next.js Error Tracking",
      description: "Install the Next.js SDK.",
      path: "/error-tracking/nextjs",
    });
    expect(metadata.title).toEqual({
      absolute: "Next.js Error Tracking | Telemetry Tracker",
    });
    expect(metadata.description).toContain("Install the Next.js SDK");
    expect(metadata.alternates?.canonical).toMatch(/\/error-tracking\/nextjs$/);
  });

  it("framework guides reuse hosted ingest snippets", () => {
    for (const path of [
      "/error-tracking/nextjs",
      "/error-tracking/react",
      "/error-tracking/nodejs",
      "/error-tracking/react-native",
    ] as const) {
      const src = readFileSync(join(appDir, pageFiles[path]), "utf8");
      expect(src).toMatch(/from "@\/lib\/sdk-setup-snippets"/);
    }
  });
});
