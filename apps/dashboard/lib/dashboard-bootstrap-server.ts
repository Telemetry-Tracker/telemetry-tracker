import { cache } from "react";
import { coalesceApiRequest } from "@/lib/api-inflight";
import { dashboardApiFetchFromCookies } from "@/lib/dashboard-api";
import { bootstrapDebugDetail } from "@/lib/dashboard-bootstrap-debug";
import { dashboardDebug } from "@/lib/dashboard-debug";
import type { DashboardUser } from "@/lib/dashboard-user";
import { toDashboardAvatarUrl } from "@/lib/avatar-url";
import { getDashboardOrganizationId } from "@/lib/dashboard-org";
import {
  getDashboardProjectCookie,
  getDashboardSessionId,
} from "@/lib/dashboard-project";

export type DashboardBootstrapData = {
  organizations: { id: string; name: string }[];
  projects: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
  }[];
  navScope: { apps: string[]; environments: string[] };
  user: DashboardUser;
};

async function loadDashboardBootstrapFromApi(): Promise<DashboardBootstrapData | null> {
  const started = Date.now();
  dashboardDebug("bootstrap", "fetch start");

  const res = await dashboardApiFetchFromCookies("/api/meta/dashboard-bootstrap");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    dashboardDebug("bootstrap", "fetch failed", {
      status: res.status,
      ms: Date.now() - started,
      body: text.slice(0, 300),
    });
    return null;
  }

  const data = (await res.json()) as {
    organizations?: { id: string; name?: string }[];
    projects?: {
      id: string;
      name: string;
      slug: string;
      organizationId?: string;
    }[];
    navScope?: { apps?: string[]; environments?: string[] };
    user?: { id: string; email: string; displayName: string | null; avatarUrl?: string | null };
  };

  const organizations = Array.isArray(data.organizations)
    ? data.organizations.map((org) => ({
        id: org.id,
        name: typeof org.name === "string" ? org.name : "",
      }))
    : [];

  const projects = Array.isArray(data.projects)
    ? data.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        organizationId: project.organizationId ?? "",
      }))
    : [];

  const navScope = {
    apps: Array.isArray(data.navScope?.apps) ? data.navScope.apps : [],
    environments: Array.isArray(data.navScope?.environments) ? data.navScope.environments : [],
  };

  const user =
    data.user && typeof data.user.id === "string"
      ? {
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName ?? null,
          avatarUrl: toDashboardAvatarUrl(data.user.avatarUrl ?? null),
        }
      : null;

  if (!user) {
    dashboardDebug("bootstrap", "missing user in payload", {
      ms: Date.now() - started,
      orgCount: organizations.length,
      projectCount: projects.length,
    });
    return null;
  }

  dashboardDebug("bootstrap", "fetch ok", {
    ms: Date.now() - started,
    orgCount: organizations.length,
    projectCount: projects.length,
    appCount: navScope.apps.length,
    envCount: navScope.environments.length,
  });

  return { organizations, projects, navScope, user };
}

async function bootstrapInflightParts(): Promise<{
  key: string;
  hasSession: boolean;
  hasProject: boolean;
  hasOrg: boolean;
}> {
  const [sessionId, projectId, orgId] = await Promise.all([
    getDashboardSessionId(),
    getDashboardProjectCookie(),
    getDashboardOrganizationId(),
  ]);
  return {
    // Full session id stays in the in-memory coalesce key only — never logged.
    key: `bootstrap:${sessionId ?? ""}:${projectId ?? ""}:${orgId ?? ""}`,
    hasSession: Boolean(sessionId),
    hasProject: Boolean(projectId),
    hasOrg: Boolean(orgId),
  };
}

/** One HTTP round trip for workspace, nav scope, user, and session context. */
export const fetchDashboardBootstrap = cache(async function fetchDashboardBootstrap(): Promise<DashboardBootstrapData | null> {
  const { key, hasSession, hasProject, hasOrg } = await bootstrapInflightParts();
  dashboardDebug(
    "bootstrap",
    "cache miss / coalesce",
    bootstrapDebugDetail({ hasSession, hasProject, hasOrg })
  );
  return coalesceApiRequest(key, loadDashboardBootstrapFromApi);
});
