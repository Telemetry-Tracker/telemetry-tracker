import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { GET as llms } from "@/app/llms.txt/route";
import Page, { dynamic, generateMetadata } from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
vi.mock("@/app/components/marketing/nav", () => ({ Nav: () => null }));
vi.mock("@/app/components/marketing/footer", () => ({ Footer: () => null }));
vi.mock("@/app/components/marketing/guides/GuideCta", () => ({ GuideCta: () => null }));

afterEach(() => vi.unstubAllEnvs());
describe("unpublished Next.js monitoring page", () => {
  it.each([undefined, "false", "TRUE", "1", ""])('returns the Next.js 404 signal with flag %s', (flag) => {
    vi.stubEnv("MONITORING_NEXTJS_PAGE_ENABLED", flag);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => Page()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
  it("evaluates the gate per request and keeps an enabled preview noindex", () => {
    expect(dynamic).toBe("force-dynamic");
    vi.stubEnv("MONITORING_NEXTJS_PAGE_ENABLED", "true");
    expect(() => Page()).not.toThrow();
    vi.stubEnv("MONITORING_NEXTJS_PAGE_ENABLED", "false");
    expect(() => Page()).toThrow(";404");
    const metadata = generateMetadata();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toEqual({ absolute: "Next.js Monitoring: Errors, Web Vitals & Releases | Telemetry Tracker" });
    expect(metadata.alternates.canonical).toBe("https://telemetry-tracker.com/monitoring/nextjs");
    expect(metadata.description?.length).toBeGreaterThanOrEqual(150);
    expect(metadata.description?.length).toBeLessThanOrEqual(160);
  });
  it("renders one H1, ordered headings and JSON-LD matching visible FAQs", () => {
    vi.stubEnv("MONITORING_NEXTJS_PAGE_ENABLED", "true");
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(Page()), "text/html");
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.textContent).toBe("Monitor a Next.js app: errors, Web Vitals and releases in one place");
    let previous = 0;
    for (const heading of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const level = Number(heading.tagName.slice(1));
      expect(level).toBeLessThanOrEqual(previous + 1);
      previous = level;
    }
    const schema = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).flatMap((script) => JSON.parse(script.textContent ?? ""));
    expect(schema.map((item) => item["@type"])).toEqual(["WebPage", "BreadcrumbList", "FAQPage"]);
    expect(schema[0].url).toBe("https://telemetry-tracker.com/monitoring/nextjs");
    expect(schema[1].itemListElement[1].item).toBe(schema[0].url);
    for (const question of schema[2].mainEntity) {
      expect(doc.body.textContent).toContain(question.name);
      expect(doc.body.textContent).toContain(question.acceptedAnswer.text);
    }
  });
  it.each(["false", "true"])("is absent from sitemap and llms.txt even with flag %s", async (flag) => {
    vi.stubEnv("MONITORING_NEXTJS_PAGE_ENABLED", flag);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://telemetry-tracker.com");
    expect(sitemap().some(({ url }) => url.includes("/monitoring/nextjs"))).toBe(false);
    expect(await llms().text()).not.toContain("/monitoring/nextjs");
    expect(readFileSync(join(import.meta.dirname, "../../..", "lib/public-seo-paths.ts"), "utf8")).not.toContain("/monitoring/nextjs");
  });
});
