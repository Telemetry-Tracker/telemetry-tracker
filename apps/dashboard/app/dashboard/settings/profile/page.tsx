import { ErrorState } from "@/app/components/ErrorState";
import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { getDashboardUser } from "@/lib/dashboard-user";
import { ProfileSettingsClient } from "./ProfileSettingsClient";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const user = await getDashboardUser();

  if (!user) {
    return (
      <>
        <SettingsPageHeader
          title="Profile"
          description="Sign in to view and edit your profile."
        />
        <ErrorState message="You must be signed in to view this page." />
      </>
    );
  }

  return <ProfileSettingsClient user={user} />;
}
