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
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
  "/sentry-alternative",
  "/self-hosted-error-tracking",
  "/error-tracking/nextjs",
  "/error-tracking/react",
  "/error-tracking/nodejs",
  "/error-tracking/react-native",
] as const;

export type PublicSeoPath = (typeof PUBLIC_SEO_PATHS)[number];

export const MARKETING_GUIDE_PATHS = [
  "/sentry-alternative",
  "/self-hosted-error-tracking",
  "/error-tracking/nextjs",
  "/error-tracking/react",
  "/error-tracking/nodejs",
  "/error-tracking/react-native",
] as const;

export function sitemapPriority(path: PublicSeoPath): number {
  if (path === "") return 1;
  if (path === "/docs") return 0.9;
  if ((MARKETING_GUIDE_PATHS as readonly string[]).includes(path)) return 0.85;
  return 0.75;
}
