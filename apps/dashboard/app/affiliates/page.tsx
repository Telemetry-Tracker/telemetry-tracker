import { notFound } from "next/navigation";
import { AffiliatesPageContent } from "@/app/components/marketing/affiliates/AffiliatesPageContent";
import { AFFILIATE_COMMISSION_PERCENT, isAffiliateProgramEnabled } from "@/lib/affiliate-program";
import { affiliatePageMetadata } from "@/lib/affiliate-metadata";
import { getDashboardSessionId } from "@/lib/dashboard-project";

export const metadata = affiliatePageMetadata({
  title: `Affiliate Program — Earn ${AFFILIATE_COMMISSION_PERCENT}% Recurring Commission`,
  ogTitle: `Earn ${AFFILIATE_COMMISSION_PERCENT}% recurring commission with Telemetry Tracker`,
  description: `Recommend Telemetry Tracker and earn ${AFFILIATE_COMMISSION_PERCENT}% recurring commission on hosted Pro and Business subscriptions for as long as your referrals keep paying. For developers, creators, newsletter authors, and OSS maintainers.`,
  path: "/affiliates",
});

export default async function AffiliatesPage() {
  if (!isAffiliateProgramEnabled()) notFound();
  const isAuthenticated = Boolean(await getDashboardSessionId());
  return <AffiliatesPageContent isAuthenticated={isAuthenticated} />;
}
