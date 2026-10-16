import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { ErrorState } from "@/app/components/ErrorState";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import {
  getDashboardOrganizationId,
  resolveActiveOrganizationId,
} from "@/lib/dashboard-org";
import { getDashboardUser } from "@/lib/dashboard-user";
import type { PendingInviteRow } from "@/app/dashboard/actions";
import { TeamMembersClient, type TeamMemberRow } from "./TeamMembersClient";

export const dynamic = "force-dynamic";

async function loadOrganizations(): Promise<{ id: string }[]> {
  const res = await dashboardApiFetch("/api/meta/organizations");
  if (!res.ok) return [];
  const data = (await res.json()) as { organizations?: { id: string }[] };
  return Array.isArray(data.organizations) ? data.organizations : [];
}

async function loadMembers(
  organizationId: string | null
): Promise<
  | { ok: true; organizationId: string | null; members: TeamMemberRow[] }
  | { ok: false; message: string }
> {
  const q = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  const res = await dashboardApiFetch(`/api/meta/members${q}`);
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, message: `Could not load members (${res.status}): ${t.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    organizationId: string | null;
    members: TeamMemberRow[];
  };
  return {
    ok: true,
    organizationId: data.organizationId,
    members: data.members ?? [],
  };
}

async function loadInvites(organizationId: string): Promise<PendingInviteRow[]> {
  const res = await dashboardApiFetch(
    `/api/meta/organizations/${encodeURIComponent(organizationId)}/invites`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { invites?: PendingInviteRow[] };
  return Array.isArray(data.invites) ? data.invites : [];
}

export default async function TeamSettingsPage() {
  const [orgs, cookieOrg, user] = await Promise.all([
    loadOrganizations(),
    getDashboardOrganizationId(),
    getDashboardUser(),
  ]);

  const requestedOrg = resolveActiveOrganizationId(cookieOrg, orgs);

  const loaded = await loadMembers(requestedOrg);

  if (!loaded.ok) {
    return (
      <>
        <SettingsPageHeader
          title="Team members"
          description="Everyone listed here belongs to the organization selected in the header. Roles apply across all projects in that organization."
        />
        <ErrorState message={loaded.message} />
      </>
    );
  }

  const organizationId = loaded.organizationId;
  const members = loaded.members;
  /** Same rule as the API (owners only). Prefer the members payload so UI matches the table — session-context can be null or misaligned with org headers. */
  const canManageMembers = Boolean(
    user && members.some((m) => m.userId === user.id && m.role === "OWNER")
  );
  const ownerCount = members.filter((m) => m.role === "OWNER").length;
  const invites = canManageMembers && organizationId ? await loadInvites(organizationId) : [];

  return (
    <>
      <SettingsPageHeader
        title="Team members"
        description="Everyone listed here belongs to the organization selected in the header. Roles apply across all projects in that organization."
      />
      {organizationId && user ? (
        <TeamMembersClient
          organizationId={organizationId}
          members={members}
          currentUserId={user.id}
          canManageMembers={canManageMembers}
          ownerCount={ownerCount}
          invites={invites}
        />
      ) : (
        <p className="text-muted-foreground">Join an organization to see members.</p>
      )}
    </>
  );
}
