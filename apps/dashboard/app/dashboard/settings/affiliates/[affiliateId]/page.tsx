import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { ErrorState } from "@/app/components/ErrorState";
import { hasAffiliateAdminAccess, loadAffiliateDetail } from "@/lib/affiliate-admin-server";
import { AffiliateDetailClient } from "./AffiliateDetailClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Affiliate",
  robots: { index: false, follow: false },
};

export default async function AffiliateDetailPage({ params }: { params: Promise<{ affiliateId: string }> }) {
  if (!(await hasAffiliateAdminAccess())) notFound();
  const { affiliateId } = await params;
  const loaded = await loadAffiliateDetail(affiliateId);
  if (!loaded.ok) {
    if ([400, 401, 403, 404].includes(loaded.status)) notFound();
    return <ErrorState message={loaded.error} />;
  }
  const affiliate = loaded.data;
  return (
    <>
      <Link
        href="/dashboard/settings/affiliates"
        className="mb-4 inline-block text-[13px] text-muted-foreground hover:text-foreground"
      >
        ← All affiliates
      </Link>
      <SettingsPageHeader
        title={affiliate.name}
        description={`${affiliate.email ?? "No email — payouts on hold until one is set"} · code ${affiliate.code} · ${affiliate.state}`}
      />
      <AffiliateDetailClient affiliate={affiliate} />
    </>
  );
}
