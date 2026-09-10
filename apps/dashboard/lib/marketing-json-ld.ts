import { resolveMetadataBase } from "@/lib/site-url";

const FALLBACK_ORIGIN = "https://telemetry-tracker.com";

export function marketingSiteOrigin(): string {
  return resolveMetadataBase()?.origin ?? FALLBACK_ORIGIN;
}

/** Organization + SoftwareApplication + WebSite graph for public marketing pages. */
export function marketingJsonLd(origin = marketingSiteOrigin()): Record<string, unknown> {
  const home = `${origin}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "Telemetry Tracker",
        url: home,
        logo: `${origin}/icon.svg`,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#app`,
        name: "Telemetry Tracker",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        url: home,
        description:
          "Free error tracking for side projects. Open-source and self-hostable. SDKs for Next.js, React, Node.js, and React Native.",
        publisher: { "@id": `${origin}/#organization` },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "EUR",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "Telemetry Tracker",
        url: home,
        publisher: { "@id": `${origin}/#organization` },
      },
    ],
  };
}
