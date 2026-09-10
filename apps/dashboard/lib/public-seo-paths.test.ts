import { describe, expect, it } from "vitest";
import { MARKETING_GUIDE_PATHS, PUBLIC_SEO_PATHS, sitemapPriority } from "./public-seo-paths";

describe("public SEO paths", () => {
  it("includes marketing guides and excludes dashboard/auth routes", () => {
    for (const path of MARKETING_GUIDE_PATHS) {
      expect(PUBLIC_SEO_PATHS).toContain(path);
    }
    expect(PUBLIC_SEO_PATHS).not.toContain("/dashboard");
    expect(PUBLIC_SEO_PATHS).not.toContain("/login");
    expect(PUBLIC_SEO_PATHS).not.toContain("/register");
  });

  it("ranks home, docs, and guides above generic public pages", () => {
    expect(sitemapPriority("")).toBe(1);
    expect(sitemapPriority("/docs")).toBe(0.9);
    expect(sitemapPriority("/error-tracking/nextjs")).toBe(0.85);
    expect(sitemapPriority("/privacy")).toBe(0.75);
  });
});
