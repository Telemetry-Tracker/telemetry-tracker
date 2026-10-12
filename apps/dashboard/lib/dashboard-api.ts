import { apiFetch } from "@/lib/api-fetch";
import { API_BASE_URL } from "@/lib/api-url";
import { resolveDashboardApiUrl } from "@/lib/dashboard-api-url";
import { getDashboardOrganizationId } from "@/lib/dashboard-org";
import { dashboardDebug } from "@/lib/dashboard-debug";
import {
  PROJECT_UUID_RE,
  dashboardApiHeaders,
  getDashboardProjectCookie,
  getDashboardSessionId,
  isValidDashboardProjectId,
  sessionScopedMetaHeaders,
} from "@/lib/dashboard-project";

export type DashboardApiFetchOptions = {
  /** When true, do not send `X-Organization-Id` (avoids 403 from a stale org cookie on `/meta/projects`). */
  omitOrganizationHeader?: boolean;
  /** When true, do not send `X-Project-Id` (for session-scoped meta reads during workspace bootstrap). */
  omitProjectHeader?: boolean;
  /**
   * Use this exact organization id as `X-Organization-Id` instead of reading the org cookie.
   * Prefer when the layout or a server action already knows the sidebar org.
   */
  organizationIdOverride?: string;
  /**
   * Use this exact project id as `X-Project-Id` instead of reading the cookie again — keeps `/api/apps`
   * and layout shell aligned when several cookie reads run in one request.
   */
  projectIdOverride?: string;
};

/** Cookie/session headers only — never calls bootstrap (avoids cache reentrancy deadlocks). */
export async function dashboardApiFetchFromCookies(
  pathAndQuery: string,
  init?: RequestInit,
  options?: Pick<
    DashboardApiFetchOptions,
    "omitOrganizationHeader" | "omitProjectHeader"
  >
): Promise<Response> {
  const [sessionId, projectCookie, orgCookie] = await Promise.all([
    getDashboardSessionId(),
    options?.omitProjectHeader ? Promise.resolve(undefined) : getDashboardProjectCookie(),
    options?.omitOrganizationHeader ? Promise.resolve(undefined) : getDashboardOrganizationId(),
  ]);

  const url = resolveDashboardApiUrl(pathAndQuery);

  dashboardDebug("fetch:cookies", pathAndQuery, {
    hasSession: Boolean(sessionId),
    projectCookie: projectCookie ?? null,
    orgCookie: orgCookie ?? null,
  });

  return apiFetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(sessionId
        ? sessionScopedMetaHeaders(sessionId, {
            projectId: projectCookie,
            organizationId: orgCookie,
          })
        : {}),
      ...init?.headers,
    },
  });
}

/** Server-side fetch: `X-Project-Id` + optional `Authorization` + optional `X-Organization-Id` from cookies. */
export async function dashboardApiFetch(
  pathAndQuery: string,
  init?: RequestInit,
  options?: DashboardApiFetchOptions
): Promise<Response> {
  const override = options?.projectIdOverride?.trim();
  const projectId =
    options?.omitProjectHeader
      ? undefined
      : override && PROJECT_UUID_RE.test(override)
        ? override
        : await getDashboardProjectCookie();
  const sessionId = await getDashboardSessionId();
  const orgOverride = options?.organizationIdOverride?.trim();
  const orgId = options?.omitOrganizationHeader
    ? undefined
    : orgOverride && PROJECT_UUID_RE.test(orgOverride)
      ? orgOverride.toLowerCase()
      : await getDashboardOrganizationId();

  const url = resolveDashboardApiUrl(pathAndQuery);

  dashboardDebug("fetch", pathAndQuery, {
    hasSession: Boolean(sessionId),
    projectId: projectId ?? null,
    orgId: orgId ?? null,
    omitProject: options?.omitProjectHeader === true,
    omitOrg: options?.omitOrganizationHeader === true,
  });

  const baseHeaders: Record<string, string> = {
    ...(isValidDashboardProjectId(projectId) ? dashboardApiHeaders(projectId) : {}),
    ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}),
    ...(orgId ? { "X-Organization-Id": orgId.toLowerCase() } : {}),
  };
  return apiFetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...baseHeaders,
      ...init?.headers,
    },
  });
}

export { API_BASE_URL as API_BASE };
