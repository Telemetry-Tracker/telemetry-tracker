import type { MetadataRoute } from "next";
import { PUBLIC_SEO_PATHS, sitemapPriority } from "@/lib/public-seo-paths";
import { siteOriginForSeo } from "@/lib/site-url";

/** Resolve public URL at request time (e.g. Railway `RAILWAY_PUBLIC_DOMAIN` after deploy). */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOriginForSeo();
  if (!origin) return [];

  return PUBLIC_SEO_PATHS.map((path) => ({
    url: `${origin}${path === "" ? "/" : path}`,
    changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
    priority: sitemapPriority(path),
  }));
}
