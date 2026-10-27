import { Suspense } from "react";
import Link from "next/link";
import { SettingsPageHeader } from "@/app/components/dashboard/settings/SettingsPageHeader";
import { OrganizationSettingsNewProjectParam } from "@/app/components/OrganizationSettingsNewProjectParam";
import { ScrollToHash } from "@/app/components/ScrollToHash";
import { ErrorState } from "@/app/components/ErrorState";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import { getDashboardSessionContext } from "@/lib/dashboard-capabilities";
import { getDashboardWorkspaceForRequest } from "@/lib/dashboard-workspace-request";
import { getDashboardUser } from "@/lib/dashboard-user";
import {
  createProjectAction,
} from "@/app/dashboard/actions";
import { CreateOrganizationForm } from "@/app/dashboard/settings/organization/CreateOrganizationForm";
import { SettingsBtn, SettingsInput, Section } from "@/app/components/dashboard/settings/settings-ui";
import { OrganizationArchiveSection } from "@/app/dashboard/settings/organization/OrganizationArchiveSection";
import { OrganizationProjectsSection } from "@/app/dashboard/settings/organization/OrganizationProjectsSection";
import { OrganizationRenameSection } from "@/app/dashboard/settings/organization/OrganizationRenameSection";
import { OrganizationUsageCard } from "@/app/dashboard/settings/organization/OrganizationUsageCard";
import { parsePaidPlanQueryParam } from "@/lib/plan-pricing";

export const dynamic = "force-dynamic";

type MemberRow = { userId: string; role: string };

async function loadMembersForOrg(
  organizationId: string
): Promise<{ ok: true; members: MemberRow[] } | { ok: false }> {
  const res = await dashboardApiFetch(
    `/api/meta/members?organizationId=${encodeURIComponent(organizationId)}`,
    undefined,
    { organizationIdOverride: organizationId }
  );
  if (!res.ok) return { ok: false };
  const data = (await res.json()) as { members?: MemberRow[] };
  return { ok: true, members: data.members ?? [] };
}

export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const planParam = typeof params.plan === "string" ? params.plan : null;
  const paidPlan = parsePaidPlanQueryParam(planParam);

  const [workspace, user] = await Promise.all([
    getDashboardWorkspaceForRequest(),
    getDashboardUser(),
  ]);

  const { organizations, resolvedOrgId, effectiveProjectId, projects } = workspace;

  const effectiveOrgId = resolvedOrgId;

  const [capabilities, membersRes] = await Promise.all([
    getDashboardSessionContext(
      effectiveProjectId === "" ? null : effectiveProjectId,
      resolvedOrgId
    ),
    effectiveOrgId !== null
      ? loadMembersForOrg(effectiveOrgId)
      : Promise.resolve({ ok: false as const }),
  ]);

  if (!user) {
    return (
      <>
        <SettingsPageHeader
          title="Organization"
          description="Sign in to manage organizations and projects."
        />
        <ErrorState message="You must be signed in to view this page." />
      </>
    );
  }

  /** Only when session-context was requested but missing — not when skipped (`effectiveProjectId === ""` for no-org / no-project scope). */
  const permissionsUnknown =
    capabilities === null && effectiveProjectId !== "";
  /** Prefer roster from GET /meta/members (same org as sidebar) — matches POST /meta/projects when session-context is missing or stale. */
  const canCreateProject = membersRes.ok
    ? membersRes.members.some((m) => m.userId === user.id && m.role === "OWNER")
    : capabilities?.canCreateProject === true;

  const activeOrgName =
    effectiveOrgId !== null
      ? (organizations.find((o) => o.id === effectiveOrgId)?.name ?? "Selected organization")
      : null;

  const createOrganizationFields = <CreateOrganizationForm planIntent={paidPlan} />;

  return (
    <>
      <Suspense fallback={null}>
        <OrganizationSettingsNewProjectParam />
      </Suspense>
      <ScrollToHash />
      <SettingsPageHeader
        title="Organization"
        description="An organization is the top-level workspace: members, billing, and projects. Switch organizations from the header. Add projects here or create another organization when you need a separate workspace."
      />

      {permissionsUnknown ? (
        <p
          className="mb-6 max-w-xl rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-foreground"
          role="status"
        >
          Usage and billing extras could not be loaded for this session (for example a stale
          project cookie). You can still add a project below if you own{" "}
          {activeOrgName ? (
            <>
              <strong>{activeOrgName}</strong>
            </>
          ) : (
            "this workspace"
          )}
          .
        </p>
      ) : null}

      {capabilities?.usageQuota && effectiveOrgId ? (
        <OrganizationUsageCard
          usage={capabilities.usageQuota}
          organizationId={effectiveOrgId}
          canManageBilling={capabilities.canManageMembers}
          hasStripeCustomer={capabilities.billingHealth?.hasStripeCustomer === true}
        />
      ) : null}

      {effectiveOrgId && activeOrgName ? (
        <div className="mb-6">
          <OrganizationRenameSection
            organizationId={effectiveOrgId}
            organizationName={activeOrgName}
            canRename={canCreateProject}
          />
        </div>
      ) : null}

      {effectiveOrgId ? (
        <div className="mb-6 flex max-w-2xl flex-col gap-3 rounded-xl border border-border bg-surface/40 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-muted-foreground">
            Use this page to{" "}
            <strong className="text-foreground">rename the workspace</strong>,{" "}
            <strong className="text-foreground">add or rename projects</strong>{" "}
            for the organization selected in the header.{" "}
            <strong className="text-foreground">Team</strong> and <strong className="text-foreground">API keys</strong>{" "}
            live under separate settings — open them from here when you need people or ingestion
            keys.
          </p>
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            <a
              href="#create-project-section"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-primary/45 bg-primary/20 px-3 text-sm font-semibold text-foreground hover:bg-primary/30"
            >
              Add a project
            </a>
            <Link
              href="/dashboard/settings/team"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              Team
            </Link>
            <Link
              href="/dashboard/settings/keys"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              API keys
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex max-w-lg flex-col gap-6">
        {effectiveOrgId ? (
          <div id="create-project-section">
          <Section
            title="Add a project"
            description={`New projects are created in ${activeOrgName ?? "this organization"}. Only organization owners can create projects.`}
            className="scroll-mt-24"
          >
            <p className="mb-4 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Selected: {activeOrgName}
            </p>
            {canCreateProject ? (
              <form action={createProjectAction} className="flex flex-col gap-3">
                <input type="hidden" name="organizationId" value={effectiveOrgId} />
                <label className="text-[13px] text-muted-foreground" htmlFor="proj-name">
                  Project name
                </label>
                <SettingsInput
                  id="proj-name"
                  name="name"
                  type="text"
                  required
                  maxLength={120}
                  placeholder="Mobile app"
                />
                <label className="text-[13px] text-muted-foreground" htmlFor="proj-slug">
                  Slug <span className="text-muted-foreground">(optional)</span>
                </label>
                <SettingsInput
                  id="proj-slug"
                  name="slug"
                  type="text"
                  maxLength={120}
                  placeholder="mobile-app"
                  autoComplete="off"
                />
                <SettingsBtn type="submit" variant="primary">
                  Create project
                </SettingsBtn>
              </form>
            ) : membersRes.ok ? (
              <p className="text-sm text-muted-foreground">
                Only an organization owner can create projects.
              </p>
            ) : permissionsUnknown ? (
              <p className="text-sm text-muted-foreground">
                We could not verify your role. Try refreshing or switch organization in the header.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Could not load members for this organization.
              </p>
            )}
          </Section>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Create an organization first—then you can add projects to it.
          </p>
        )}

        {organizations.length > 0 ? (
          <details className="group overflow-hidden rounded-xl border border-border bg-surface/40 open:border-brand/30">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="underline decoration-muted-foreground/50 underline-offset-2 group-open:no-underline">
                Create another organization
              </span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Optional — separate workspace with its own billing and members.
              </span>
            </summary>
            <div className="border-t border-border px-4 py-4">{createOrganizationFields}</div>
          </details>
        ) : (
          <Section title="Your first organization" description="You become the owner. Then add a project for API keys and ingest.">
            {createOrganizationFields}
          </Section>
        )}
      </div>

      {effectiveOrgId && projects.length > 0 ? (
        <OrganizationProjectsSection
          projects={projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug }))}
          canRename={canCreateProject}
        />
      ) : null}

      {effectiveOrgId && activeOrgName ? (
        <OrganizationArchiveSection
          organizationId={effectiveOrgId}
          organizationName={activeOrgName}
          projects={projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug }))}
          canArchiveProject={capabilities?.canArchiveProject === true}
          canArchiveOrganization={capabilities?.canArchiveOrganization === true}
        />
      ) : null}
    </>
  );
}
