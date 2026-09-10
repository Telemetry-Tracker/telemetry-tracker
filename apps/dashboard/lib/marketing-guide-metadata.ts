import type { Metadata } from "next";
import { socialPreviewImage } from "@/lib/social-image";
import { metadataBaseOrFallback } from "@/lib/site-url";

export function marketingGuideMetadata(opts: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const origin = metadataBaseOrFallback().origin;
  const url = `${origin}${opts.path}`;
  const absoluteTitle = `${opts.title} | Telemetry Tracker`;

  return {
    title: { absolute: absoluteTitle },
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: absoluteTitle,
      description: opts.description,
      url,
      images: [socialPreviewImage],
    },
    twitter: {
      title: absoluteTitle,
      description: opts.description,
      images: [socialPreviewImage.url],
    },
  };
}

export function breadcrumbJsonLd(
  origin: string,
  crumbs: ReadonlyArray<{ name: string; path: string }>
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${origin}${crumb.path === "" ? "/" : crumb.path}`,
    })),
  };
}

export function howToJsonLd(opts: {
  name: string;
  description: string;
  url: string;
  steps: ReadonlyArray<{ name: string; text: string }>;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    step: opts.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  };
}

export function webPageJsonLd(opts: {
  origin: string;
  path: string;
  name: string;
  description: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.name,
    description: opts.description,
    url: `${opts.origin}${opts.path}`,
    isPartOf: { "@id": `${opts.origin}/#website` },
    about: { "@id": `${opts.origin}/#app` },
  };
}
