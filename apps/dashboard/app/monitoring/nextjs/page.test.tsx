import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { GET as llms } from "@/app/llms.txt/route";
import Page, { generateMetadata } from "./page";

vi.mock("@/app/components/marketing/nav", () => ({ Nav: () => null }));
vi.mock("@/app/components/marketing/footer", () => ({ Footer: () => null }));
vi.mock("@/app/components/marketing/guides/GuideCta", () => ({ GuideCta: () => null }));

afterEach(() => vi.unstubAllEnvs());
describe("published Next.js monitoring page", () => {
  it("renders without errors", () => {
    expect(() => Page()).not.toThrow();
  });
  it("has indexable metadata with correct canonical and description", () => {
    const metadata = generateMetadata();
    expect(metadata.robots).toBeUndefined();
    expect(metadata.title).toEqual({ absolute: "Next.js Monitoring: Errors, Web Vitals & Releases | Telemetry Tracker" });
    expect(metadata.alternates.canonical).toBe("https://telemetry-tracker.com/monitoring/nextjs");
    expect(metadata.description?.length).toBeGreaterThanOrEqual(150);
    expect(metadata.description?.length).toBeLessThanOrEqual(160);
  });
  it("renders one H1, ordered headings and JSON-LD matching visible FAQs", () => {
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
  it("is present in sitemap and llms.txt", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://telemetry-tracker.com");
    expect(sitemap().some(({ url }) => url.includes("/monitoring/nextjs"))).toBe(true);
    expect(await llms().text()).toContain("/monitoring/nextjs");
    expect(readFileSync(join(import.meta.dirname, "../../..", "lib/public-seo-paths.ts"), "utf8")).toContain("/monitoring/nextjs");
  });
});
