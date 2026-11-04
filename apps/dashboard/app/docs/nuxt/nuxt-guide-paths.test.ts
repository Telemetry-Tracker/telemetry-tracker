import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression for TT-037 (#922): Nuxt 4 ignores root plugins/ and middleware/, so the guide
// must point at app/plugins and app/middleware (and keep the Nuxt 3 root paths as a note).
const root = path.resolve(__dirname, "../../../../..");
const sources = {
  page: readFileSync(path.join(__dirname, "page.tsx"), "utf8"),
  markdown: readFileSync(path.join(root, "docs/sdk-nuxt.md"), "utf8"),
  marketing: readFileSync(path.join(__dirname, "../../components/marketing/sdks.tsx"), "utf8"),
};

describe("Nuxt guide file paths (#922)", () => {
  for (const [name, src] of Object.entries(sources)) {
    it(`${name}: primary paths are under app/ for Nuxt 4`, () => {
      expect(src).toContain("app/plugins/telemetry.client.ts");
      if (name !== "marketing") {
        expect(src).toContain("app/middleware/telemetry.global.ts");
        // every root-path mention is labelled as the Nuxt 3 alternative
        const rootMentions = src.match(/(?<![\w/])(plugins\/telemetry\.client\.ts|middleware\/telemetry\.global\.ts)/g) ?? [];
        const nuxt3Labelled = src.match(/Nuxt 3:[^\n]*\n?[^\n]*(plugins|middleware)\/telemetry/g) ?? [];
        expect(rootMentions.length).toBe(nuxt3Labelled.length);
      }
    });
    it(`${name}: installs the Vue component error handler (#919)`, () => {
      expect(src).toContain("installVueErrorHandler(nuxtApp.vueApp)");
    });
  }
  it("does not use the deprecated process.dev", () => {
    expect(sources.page).not.toContain("process.dev");
    expect(sources.markdown).not.toContain("process.dev");
  });
});
