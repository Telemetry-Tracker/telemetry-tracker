import type { Metadata } from "next";
import { Nav } from "@/app/components/marketing/nav";
import { Hero } from "@/app/components/marketing/hero";
import { SupportedSdks } from "@/app/components/marketing/supported-sdks";
import { Features } from "@/app/components/marketing/features";
import { Sdks } from "@/app/components/marketing/sdks";
import { ProductShots } from "@/app/components/marketing/product-shots";
import { Pricing } from "@/app/components/marketing/pricing";
import { DocsPreview } from "@/app/components/marketing/docs-preview";
import { Cta } from "@/app/components/marketing/cta";
import { Footer } from "@/app/components/marketing/footer";
import { socialPreviewImage } from "@/lib/social-image";
import { metadataBaseOrFallback } from "@/lib/site-url";

const homeTitle = "Free Error Tracking for Side Projects | Telemetry Tracker";
const homeDescription =
  "Free error tracking for side projects. No credit card. Install a Next.js, React, Node.js, or React Native SDK and see your first error in minutes. Open source and self-hostable.";

export function generateMetadata(): Metadata {
  const origin = metadataBaseOrFallback().origin;

  return {
    title: { absolute: homeTitle },
    description: homeDescription,
    alternates: { canonical: `${origin}/` },
    openGraph: {
      title: homeTitle,
      description: homeDescription,
      url: `${origin}/`,
      images: [socialPreviewImage],
    },
    twitter: {
      title: homeTitle,
      description: homeDescription,
      images: [socialPreviewImage.url],
    },
  };
}

export default function LandingPage() {
  return (
    <main id="main-content" className="marketing-main-offset min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <SupportedSdks />
      <Features />
      <Sdks />
      <ProductShots />
      <Pricing />
      <DocsPreview />
      <Cta />
      <Footer />
    </main>
  );
}
