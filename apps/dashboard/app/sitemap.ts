import type { MetadataRoute } from "next";
import { SITEMAP_LAST_MODIFIED, sitemapPaths, sitemapPriority } from "@/lib/public-seo-paths";
import { isAffiliateProgramEnabled } from "@/lib/affiliate-program";
import { siteOriginForSeo } from "@/lib/site-url";

/** Resolve public URL at request time (e.g. Railway `RAILWAY_PUBLIC_DOMAIN` after deploy). */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOriginForSeo();
  if (!origin) return [];

  return sitemapPaths(isAffiliateProgramEnabled()).map((path) => ({
    url: `${origin}${path === "" ? "/" : path}`,
    lastModified: SITEMAP_LAST_MODIFIED,
    changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
    priority: sitemapPriority(path),
  }));
}
