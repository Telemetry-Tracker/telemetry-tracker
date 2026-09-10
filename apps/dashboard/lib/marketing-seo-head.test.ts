import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(import.meta.dirname, "..", "app");

describe("marketing SEO head flushing", () => {
  it("root layout does not await cookies so title can render in <head>", () => {
    const src = readFileSync(join(appDir, "layout.tsx"), "utf8");
    expect(src).not.toMatch(/getCookieConsentChoiceFromCookies/);
    expect(src).not.toMatch(/await cookies\(/);
    expect(src).toMatch(/export default function RootLayout/);
    expect(src).not.toMatch(/openGraph:\s*\{[^}]*title:/s);
    expect(src).not.toMatch(/twitter:\s*\{[^}]*title:/s);
  });

  it("homepage is a static server page with no session cookie read", () => {
    const src = readFileSync(join(appDir, "page.tsx"), "utf8");
    expect(src).toMatch(/export default function LandingPage/);
    expect(src).not.toMatch(/getDashboardSessionId/);
    expect(src).not.toMatch(/cookies\(/);
    expect(src).toContain("Free Error Tracking for Side Projects");
  });
});
