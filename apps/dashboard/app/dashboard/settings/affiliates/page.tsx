import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { parseAffiliateApplicationFilter } from "@/lib/affiliate-admin-types";
import {
  hasAffiliateAdminAccess,
  isAffiliateAdminDenied,
  loadAffiliateApplications,
  loadAffiliates,
} from "@/lib/affiliate-admin-server";
import { AffiliatesAdminClient } from "./AffiliatesAdminClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Affiliates",
  robots: { index: false, follow: false },
};

export default async function AffiliatesAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Server-side gate: the API decides (flag / session / AFFILIATE_ADMIN_EMAILS); anything else is a 404.
  if (!(await hasAffiliateAdminAccess())) notFound();

  const status = parseAffiliateApplicationFilter((await searchParams).status);
  const [applications, affiliates] = await Promise.all([loadAffiliateApplications(status), loadAffiliates()]);
  if (
    (!applications.ok && isAffiliateAdminDenied(applications.status)) ||
    (!affiliates.ok && isAffiliateAdminDenied(affiliates.status))
  ) {
    notFound();
  }

  return (
    <>
      <SettingsPageHeader
        title="Affiliates"
        description="Founder-only. Review applications, share referral links, and record manual payouts."
      />
      <AffiliatesAdminClient
        status={status}
        applications={applications.ok ? applications.data.applications : []}
        applicationsError={applications.ok ? null : applications.error}
        affiliates={affiliates.ok ? affiliates.data.affiliates : []}
        affiliatesError={affiliates.ok ? null : affiliates.error}
      />
    </>
  );
}
