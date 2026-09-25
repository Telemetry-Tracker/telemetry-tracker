import type { Metadata } from "next";
import { Nav } from "@/app/components/marketing/nav";
import { Pricing } from "@/app/components/marketing/pricing";
import { Cta } from "@/app/components/marketing/cta";
import { Footer } from "@/app/components/marketing/footer";
import { getDashboardSessionId } from "@/lib/dashboard-project";

export const metadata: Metadata = {
  title: { absolute: "Pricing · Telemetry Tracker" },
  description:
    "Telemetry Tracker pricing in EUR. Free for side projects, then Pro and Business as ingest grows. No surprise overage bills.",
  alternates: { canonical: "./" },
  openGraph: {
    title: "Pricing — Telemetry Tracker",
    description:
      "Free error tracking for side projects. Pro and Business plans in EUR, capped at your plan limit.",
  },
};

export default async function PricingPage() {
  const isAuthenticated = Boolean(await getDashboardSessionId());

  return (
    <main id="main-content" className="marketing-main-offset min-h-screen bg-background text-foreground">
      <Nav isAuthenticated={isAuthenticated} />
      <Pricing isAuthenticated={isAuthenticated} headingLevel="h1" />
      <Cta isAuthenticated={isAuthenticated} />
      <Footer />
    </main>
  );
}
