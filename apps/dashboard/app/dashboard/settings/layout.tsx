import { SettingsNav } from "@/app/components/dashboard/settings/SettingsNav";
import { hasAffiliateAdminAccess } from "@/lib/affiliate-admin-server";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // Server-side: only founders on AFFILIATE_ADMIN_EMAILS see the Founder group (no API call when the flag is off).
  const showFounderAdmin = await hasAffiliateAdminAccess();
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
      <SettingsNav showFounderAdmin={showFounderAdmin} />
      <section className="min-w-0">{children}</section>
    </div>
  );
}
