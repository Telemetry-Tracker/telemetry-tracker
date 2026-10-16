import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { getDashboardProjectId } from "@/lib/dashboard-project";
import { SourceMapsSettingsClient } from "./SourceMapsSettingsClient";

export const dynamic = "force-dynamic";

export default async function SourceMapsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string; release?: string }>;
}) {
  const q = await searchParams;
  const initialApp = typeof q.app === "string" ? q.app : "";
  const initialRelease = typeof q.release === "string" ? q.release : "";
  const projectId = await getDashboardProjectId();

  return (
    <>
      <SettingsPageHeader
        title="Source maps"
        description="View uploaded maps per app and release. Upload via API or CI; symbolicated stacks appear on error detail when maps match the release."
      />
      <SourceMapsSettingsClient projectId={projectId} initialApp={initialApp} initialRelease={initialRelease} />
    </>
  );
}
