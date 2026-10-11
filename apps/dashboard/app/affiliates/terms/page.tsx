import { notFound } from "next/navigation";
import { AffiliateTermsContent } from "@/app/components/marketing/affiliates/AffiliateTermsContent";
import { AFFILIATE_COMMISSION_PERCENT, isAffiliateProgramEnabled } from "@/lib/affiliate-program";
import { affiliatePageMetadata } from "@/lib/affiliate-metadata";
import { getDashboardSessionId } from "@/lib/dashboard-project";

export const metadata = affiliatePageMetadata({
  title: "Affiliate Terms",
  description: `Terms of the Telemetry Tracker affiliate program: ${AFFILIATE_COMMISSION_PERCENT}% recurring commission on hosted Pro and Business revenue, referral window, payouts, and promotion rules.`,
  path: "/affiliates/terms",
});

export default async function AffiliateTermsPage() {
  if (!isAffiliateProgramEnabled()) notFound();
  const isAuthenticated = Boolean(await getDashboardSessionId());
  return <AffiliateTermsContent isAuthenticated={isAuthenticated} />;
}
