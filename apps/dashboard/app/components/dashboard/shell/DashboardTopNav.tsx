import { Suspense } from "react";
import type { OrgOption, ProjectOption } from "@/lib/dashboard-workspace-types";
import type { DashboardUser } from "@/lib/dashboard-user";
import { DashboardChrome } from "./DashboardChrome";
import { DashboardNotificationsLoader } from "./DashboardNotificationsLoader";
import { NavScopePickersLoader } from "./NavScopePickersLoader";
import { NavScopePickersSkeleton } from "./NavScopePickersSkeleton";

function NotificationsFallback() {
  return (
    <div
      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground"
      aria-hidden
    >
      <span className="h-4 w-4 animate-pulse rounded bg-muted" />
    </div>
  );
}

export function DashboardTopNav({
  organizations,
  currentOrganizationId,
  projects,
  currentProjectId,
  user,
  environments,
  apps,
  commandPaletteEnabled,
}: {
  organizations: OrgOption[];
  currentOrganizationId: string | null;
  projects: ProjectOption[];
  currentProjectId: string;
  user: DashboardUser | null;
  environments: string[];
  apps: string[];
  commandPaletteEnabled: boolean;
}) {
  const pickerProps = {
    organizations,
    currentOrganizationId,
    projects,
    currentProjectId,
    environments,
    apps,
  };

  return (
    <DashboardChrome
      currentOrganizationId={currentOrganizationId}
      currentProjectId={currentProjectId}
      user={user}
      commandPaletteEnabled={commandPaletteEnabled}
      sidebarWorkspace={
        <Suspense fallback={<NavScopePickersSkeleton variant="sidebar" />}>
          <NavScopePickersLoader {...pickerProps} variant="sidebar" />
        </Suspense>
      }
      headerScope={
        <Suspense fallback={<NavScopePickersSkeleton variant="header" />}>
          <NavScopePickersLoader {...pickerProps} variant="header" />
        </Suspense>
      }
      notificationsSlot={
        <Suspense fallback={<NotificationsFallback />}>
          <DashboardNotificationsLoader />
        </Suspense>
      }
    />
  );
}
