import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { GET as llms } from "@/app/llms.txt/route";
import { EXPO_ROUTER_BOUNDARY_DRAFT } from "@/lib/draft-guides";
import Page, { generateMetadata } from "./page";

vi.mock("@/app/components/marketing/nav", () => ({ Nav: () => null }));
vi.mock("@/app/components/marketing/footer", () => ({ Footer: () => null }));
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://telemetry-tracker.com"));
afterEach(() => vi.unstubAllEnvs());
const appRoot = resolve(import.meta.dirname, "../../..");
function document() {
  return new DOMParser().parseFromString(renderToStaticMarkup(Page()), "text/html");
}

describe("unpublished Expo Router boundary guide", () => {
  it("has canonical, social metadata and noindex/nofollow", () => {
    const metadata = generateMetadata();
    expect(EXPO_ROUTER_BOUNDARY_DRAFT.published).toBe(false);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toEqual({ absolute: "Expo Router ErrorBoundary: Report Caught Errors (with Code) | Telemetry Tracker" });
    expect(metadata.alternates?.canonical).toBe(`https://telemetry-tracker.com${EXPO_ROUTER_BOUNDARY_DRAFT.path}`);
    expect(metadata.openGraph).toMatchObject({ url: metadata.alternates?.canonical, description: metadata.description });
    expect(metadata.description?.length).toBeGreaterThanOrEqual(140);
    expect(metadata.description?.length).toBeLessThanOrEqual(160);
  });

  it("renders reporting, setup, boundary levels, retry and guarded preview code", () => {
    const doc = document();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    const code = Array.from(doc.querySelectorAll("pre")).map(el => el.textContent).join("\n");
    for (const snippet of ["useEffect", "trackError(error", "[error, route]", "useSegments()", "onPress={retry}", "init({", "screenErrorBoundary", "unstable_screenErrorBoundary", 'createReportingErrorBoundary("checkout")', "await submitPayment()", 'EXPO_PUBLIC_SHOW_DEBUG !== "1"']) {
      expect(code).toContain(snippet);
    }
    expect(code).not.toContain("usePathname");
    expect(doc.body.textContent).toContain("Unpublished draft");
    expect(doc.body.textContent).toContain("TODO: real dashboard screenshot");
    expect(doc.body.textContent).toContain("Uncaught render errors without any boundary remain unresolved");
  });

  it("renders valid HowTo, breadcrumbs and FAQ matching visible text", () => {
    const metadata = generateMetadata();
    const doc = document();
    const data = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(el => JSON.parse(el.textContent ?? ""));
    expect(data.map(item => item["@type"])).toEqual(["HowTo", "BreadcrumbList", "FAQPage"]);
    expect(data[0].url).toBe(metadata.alternates?.canonical);
    expect(data[0].step).toHaveLength(4);
    expect(data[1].itemListElement.at(-1).item).toBe(data[0].url);
    expect(data[2].mainEntity).toHaveLength(6);
    for (const question of data[2].mainEntity) {
      expect(doc.body.textContent).toContain(question.name);
      expect(doc.body.textContent).toContain(question.acceptedAnswer.text);
    }
  });

  it("links only to existing approved internal routes", () => {
    const allowed = ["/error-tracking/react-native", "/docs/react-native", "/error-tracking/react-native/expo-source-maps", "/docs/releases", "/docs/sdk-privacy", "/docs/alerts", "/error-tracking/react", "/sentry-alternative", "/docs/hosted-cloud", "/pricing"];
    const hrefs = Array.from(document().querySelectorAll('a[href^="/"]')).map(a => a.getAttribute("href"));
    expect(new Set(hrefs)).toEqual(new Set(allowed));
    for (const href of allowed) expect(existsSync(join(appRoot, href, "page.tsx"))).toBe(true);
  });

  it("stays out of sitemap, llms.txt and all other published pages/components", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://telemetry-tracker.com");
    for (const enabled of ["true", "false"]) {
      vi.stubEnv("NEXT_PUBLIC_AFFILIATES_ENABLED", enabled);
      expect(sitemap().some(({ url }) => url.endsWith(EXPO_ROUTER_BOUNDARY_DRAFT.path))).toBe(false);
    }
    expect(await llms().text()).not.toContain(EXPO_ROUTER_BOUNDARY_DRAFT.path);
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (file === import.meta.dirname) continue;
        if (entry.isDirectory()) scan(file);
        else if (/\.(tsx?|mdx?)$/.test(file) && !/\.(test|spec)\./.test(file)) {
          expect(readFileSync(file, "utf8"), file).not.toContain(EXPO_ROUTER_BOUNDARY_DRAFT.path);
        }
      }
    }
    scan(appRoot);
  });
});
