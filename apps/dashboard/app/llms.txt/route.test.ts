import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("serves verified capabilities, integration boundaries and free-plan limits", async () => {
  const response = GET();
  expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  const body = await response.text();
  for (const fact of [
    "source maps", "trackEvent", "not session replay", "LCP, INP, CLS and TTFB",
    "FID is supported as a metric, but is not automatically captured", "request latency",
    "release health", "Microsoft Teams", "not OAuth apps", "error-count rules",
    "API-only", "Vue and Nuxt", "NestJS via node", "without dedicated SDK packages",
    "250K ingest units", "14-day retention", "1 project, 2 API keys",
    "HTTP 429", "no credit card", "## Not for model training", "## Canonical pages",
    "Not available: distributed tracing", "Coming soon placeholders",
  ]) expect(body).toContain(fact);
});

it("uses the configured canonical origin in links", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  const body = await GET().text();
  expect(body).toContain("https://example.com/docs/dashboard");
  expect(body).toContain("https://example.com/pricing");
  expect(body).toContain("https://example.com/error-tracking/react-native/expo-source-maps");
});
