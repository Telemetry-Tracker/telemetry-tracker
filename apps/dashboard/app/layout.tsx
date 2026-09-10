import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { CookieConsent } from "@/app/components/marketing/cookie-consent";
import { MarketingJsonLd } from "@/app/components/marketing/MarketingJsonLd";
import { GoogleAnalytics } from "@/app/components/analytics/GoogleAnalytics";
import { ProductTelemetry } from "@/app/components/analytics/ProductTelemetry";
import { ThemeColorMeta } from "@/app/components/ThemeColorMeta";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { NavigationProgress } from "@/app/components/ui/NavigationProgress";
import { ToasterProvider } from "@/app/components/ToasterProvider";
import { getGoogleAnalyticsMeasurementId } from "@/lib/google-analytics";
import { socialPreviewImage } from "@/lib/social-image";
import { metadataBaseOrFallback } from "@/lib/site-url";
import "./globals.css";
import "./filter-day-picker.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#1e222b" },
  ],
};

const defaultTitle = "Free Error Tracking for Side Projects | Telemetry Tracker";
const defaultDescription =
  "Free error tracking for side projects. No credit card. Install a Next.js, React, Node.js, or React Native SDK and see your first error in minutes. Open source and self-hostable.";

const metadataBase = metadataBaseOrFallback();
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: defaultTitle,
    template: "%s · Telemetry Tracker",
  },
  description: defaultDescription,
  applicationName: "Telemetry Tracker",
  keywords: [
    "free error tracking",
    "open source error tracking",
    "Sentry alternative",
    "self-hosted error tracking",
    "Next.js error tracking",
    "React error tracking",
    "Node.js error tracking",
    "React Native error tracking",
  ],
  robots: { index: true, follow: true },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Telemetry Tracker",
    title: defaultTitle,
    description: defaultDescription,
    images: [socialPreviewImage],
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
    images: [socialPreviewImage.url],
  },
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const measurementId = getGoogleAnalyticsMeasurementId();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <ThemeColorMeta />
          <MarketingJsonLd />
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <ToasterProvider />
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          {children}
          <ProductTelemetry />
          <GoogleAnalytics measurementId={measurementId} />
          <CookieConsent />
        </ThemeProvider>
      </body>
    </html>
  );
}
