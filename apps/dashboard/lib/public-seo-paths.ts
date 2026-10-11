/**
 * Public, indexable marketing and docs paths for sitemap.xml.
 * Dashboard, auth, and other noindex routes must stay out of this list.
 */
export const PUBLIC_SEO_PATHS = [
  "",
  "/docs",
  "/docs/hosted-cloud",
  "/docs/sdk",
  "/docs/dashboard",
  "/docs/nextjs",
  "/docs/node",
  "/docs/nestjs",
  "/docs/nuxt",
  "/docs/vue",
  "/docs/react-native",
  "/docs/releases",
  "/docs/source-maps",
  "/docs/self-hosting",
  "/docs/alerts",
  "/docs/migrate-from-sentry",
  "/contact",
  "/pricing",
  "/privacy",
  "/terms",
  "/cookies",
  "/sentry-alternative",
  "/self-hosted-error-tracking",
  "/error-tracking/nextjs",
  "/error-tracking/nextjs/server-components-render-error",
  "/error-tracking/react",
  "/error-tracking/nodejs",
  "/error-tracking/react-native",
] as const;

/** Affiliate program pages: indexable, but only listed when NEXT_PUBLIC_AFFILIATES_ENABLED=true. */
export const AFFILIATE_SEO_PATHS = ["/affiliates", "/affiliates/terms"] as const;

export type PublicSeoPath =
  | (typeof PUBLIC_SEO_PATHS)[number]
  | (typeof AFFILIATE_SEO_PATHS)[number];

/** All sitemap paths for this build (affiliate pages follow the program flag). */
export function sitemapPaths(affiliatesEnabled: boolean): readonly PublicSeoPath[] {
  return affiliatesEnabled ? [...PUBLIC_SEO_PATHS, ...AFFILIATE_SEO_PATHS] : PUBLIC_SEO_PATHS;
}

export const MARKETING_GUIDE_PATHS = [
  "/sentry-alternative",
  "/self-hosted-error-tracking",
  "/error-tracking/nextjs",
  "/error-tracking/nextjs/server-components-render-error",
  "/error-tracking/react",
  "/error-tracking/nodejs",
  "/error-tracking/react-native",
] as const;

/** Content date for sitemap lastmod. Bump when public pages change. */
export const SITEMAP_LAST_MODIFIED = new Date("2026-10-06T00:00:00.000Z");

export function sitemapPriority(path: PublicSeoPath): number {
  if (path === "") return 1;
  if (path === "/docs") return 0.9;
  if ((MARKETING_GUIDE_PATHS as readonly string[]).includes(path)) return 0.85;
  return 0.75;
}
