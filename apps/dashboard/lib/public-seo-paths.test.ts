import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import {
  AFFILIATE_SEO_PATHS,
  MARKETING_GUIDE_PATHS,
  PUBLIC_SEO_PATHS,
  sitemapPaths,
  sitemapPriority,
} from "./public-seo-paths";

describe("public SEO paths", () => {
  it("includes marketing guides and excludes dashboard/auth routes", () => {
    for (const path of MARKETING_GUIDE_PATHS) {
      expect(PUBLIC_SEO_PATHS).toContain(path);
    }
    expect(PUBLIC_SEO_PATHS).not.toContain("/dashboard");
    expect(PUBLIC_SEO_PATHS).not.toContain("/login");
    expect(PUBLIC_SEO_PATHS).not.toContain("/register");
    expect(PUBLIC_SEO_PATHS).toContain("/pricing");
    expect(PUBLIC_SEO_PATHS).toContain("/docs/source-maps");
    expect(PUBLIC_SEO_PATHS).toContain("/docs/self-hosting");
    expect(PUBLIC_SEO_PATHS).toContain("/docs/alerts");
    expect(PUBLIC_SEO_PATHS).toContain("/docs/migrate-from-sentry");
    expect(PUBLIC_SEO_PATHS).toContain(
      "/error-tracking/nextjs/server-components-render-error"
    );
    expect(PUBLIC_SEO_PATHS).not.toContain("/error-tracking/nextjs/source-maps");
  });

  it("ranks home, docs, and guides above generic public pages", () => {
    expect(sitemapPriority("")).toBe(1);
    expect(sitemapPriority("/docs")).toBe(0.9);
    expect(sitemapPriority("/error-tracking/nextjs")).toBe(0.85);
    expect(sitemapPriority("/privacy")).toBe(0.75);
  });

  it("lists affiliate pages in the sitemap only when the program is enabled", () => {
    expect(sitemapPaths(true)).toEqual(expect.arrayContaining(["/affiliates", "/affiliates/terms"]));
    for (const path of AFFILIATE_SEO_PATHS) {
      expect(sitemapPaths(false)).not.toContain(path);
    }
  });

  it("does not block affiliate pages in robots.txt", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    for (const rule of list) {
      const disallow = ([] as string[]).concat(rule.disallow ?? []);
      for (const path of AFFILIATE_SEO_PATHS) {
        expect(disallow.some((d) => path.startsWith(d))).toBe(false);
      }
    }
  });
});
