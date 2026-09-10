import { describe, expect, it } from "vitest";
import { marketingJsonLd } from "./marketing-json-ld";

describe("marketingJsonLd", () => {
  it("emits Organization, SoftwareApplication, and WebSite", () => {
    const json = marketingJsonLd("https://telemetry-tracker.com");
    const graph = json["@graph"] as Array<{ "@type": string; url?: string }>;
    const types = graph.map((node) => node["@type"]);
    expect(types).toEqual(["Organization", "SoftwareApplication", "WebSite"]);
    expect(graph[0]?.url).toBe("https://telemetry-tracker.com/");
    const app = graph.find((node) => node["@type"] === "SoftwareApplication") as {
      offers?: { priceCurrency?: string };
    };
    expect(app?.offers?.priceCurrency).toBe("EUR");
  });
});
