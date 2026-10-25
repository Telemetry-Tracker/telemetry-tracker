import type { Metadata } from "next";
import { socialPreviewImage } from "@/lib/social-image";
import { metadataBaseOrFallback } from "@/lib/site-url";

/** Indexable metadata for /affiliates and /affiliates/terms (canonical + OG + Twitter). */
export function affiliatePageMetadata(opts: {
  title: string;
  ogTitle?: string;
  description: string;
  path: "/affiliates" | "/affiliates/terms";
}): Metadata {
  const origin = metadataBaseOrFallback().origin;
  const url = `${origin}${opts.path}`;
  const absoluteTitle = `${opts.title} | Telemetry Tracker`;
  const socialTitle = opts.ogTitle ?? absoluteTitle;
  return {
    title: { absolute: absoluteTitle },
    description: opts.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "Telemetry Tracker",
      title: socialTitle,
      description: opts.description,
      url,
      images: [socialPreviewImage],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: opts.description,
      images: [socialPreviewImage.url],
    },
  };
}
