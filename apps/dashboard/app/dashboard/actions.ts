"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/lib/api-url";
import { preferenceCookiesAllowedFromCookies, preferenceCookiesDeniedMessage } from "@/lib/cookie-consent-server";
import { dashboardApiFetch, type DashboardApiFetchOptions } from "@/lib/dashboard-api";
import { getDashboardWorkspaceForRequest } from "@/lib/dashboard-workspace-request";
import {
  fetchDashboardOrganizationsPayload,
  TELEMETRY_ORG_COOKIE,
} from "@/lib/dashboard-org";
import {
  parseNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notification-preferences-shared";
import {
  parseDashboardPreferences,
  type DashboardPreferences,
} from "@/lib/dashboard-preferences-shared";
import {
  parseProjectAlertSettings,
  type ProjectAlertSettings,
} from "@/lib/alert-settings";
import {
  fetchAuthSessions,
  type FetchAuthSessionsResult,
} from "@/lib/security-settings";
import {
  DEFAULT_PROJECT_ID,
  TELEMETRY_PROJECT_COOKIE,
  getDashboardProjectId,
  getDashboardSessionId,
  isValidDashboardProjectId,
  sessionScopedMetaHeaders,
} from "@/lib/dashboard-project";

export async function setDashboardProjectId(projectId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const trimmed = projectId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(trimmed)) {
    return { ok: false, error: "Invalid project id" };
  }
  if (!(await preferenceCookiesAllowedFromCookies())) {
    return { ok: false, error: await preferenceCookiesDeniedMessage() };
  }
  const c = await cookies();
  c.set(TELEMETRY_PROJECT_COOKIE, trimmed.toLowerCase(), {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 400,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Clear cookie → API falls back to default project. */
export async function resetDashboardProjectId(): Promise<void> {
  if (!(await preferenceCookiesAllowedFromCookies())) {
    return;
  }
  const c = await cookies();
  c.set(TELEMETRY_PROJECT_COOKIE, DEFAULT_PROJECT_ID, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 400,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/dashboard", "layout");
}

export async function updateProfileAction(
  displayName: string
): Promise<{ ok: true; displayName: string | null } | { ok: false; error: string }> {
  const trimmed = displayName.trim();
  const res = await dashboardApiFetch(
    "/api/auth/me",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: trimmed }),
    },
    { omitOrganizationHeader: true, omitProjectHeader: true }
  );
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  try {
    const data = (await res.json()) as { user?: { displayName?: string | null } };
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/settings/profile");
    return { ok: true, displayName: data.user?.displayName ?? null };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}

const cookieOpts = {
  path: "/",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 400,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};

function applyProjectCookieForOrganizationSwitch(
  c: Awaited<ReturnType<typeof cookies>>,
  currentProjectId: string,
  nextProject: string
): void {
  const currentNorm = currentProjectId.trim().toLowerCase();
  const nextNorm = nextProject.trim().toLowerCase();
  if (nextNorm === currentNorm) return;
  if (isValidDashboardProjectId(nextProject)) {
    c.set(TELEMETRY_PROJECT_COOKIE, nextNorm, cookieOpts);
  } else {
    c.set(TELEMETRY_PROJECT_COOKIE, "", { ...cookieOpts, maxAge: 0 });
  }
}

/**
 * After switching active org (or creating one), choose a `telemetry_project_id` that is valid for
 * the target org. When that org has no projects, return empty so we do not scope API reads to
 * another org's project or the env default.
 */
async function resolveProjectCookieForOrganization(
  sessionId: string,
  orgId: string,
  currentProjectId: string,
  /** When set, parsed org-scoped `/meta/projects` body (same scope as verify with `X-Organization-Id` for `orgId`). */
  orgScopedProjectsPayload?: { projects?: { id: string }[] }
): Promise<string> {
  const trimmedOrg = orgId.trim().toLowerCase();
  let data: { projects?: { id: string }[] };
  if (orgScopedProjectsPayload !== undefined) {
    data = orgScopedProjectsPayload;
  } else {
    const res = await fetch(`${API_BASE_URL}/api/meta/projects`, {
      cache: "no-store",
      headers: sessionScopedMetaHeaders(sessionId, {
        projectId: currentProjectId,
        organizationId: trimmedOrg,
      }),
    });
    if (!res.ok) {
      return isValidDashboardProjectId(currentProjectId) ? currentProjectId : "";
    }
    data = (await res.json()) as { projects?: { id: string }[] };
  }
  const inOrgIds = data.projects?.map((p) => p.id) ?? [];
  const current = currentProjectId.trim().toLowerCase();
  if (current && inOrgIds.some((id) => id.toLowerCase() === current)) {
    return currentProjectId;
  }
  if (inOrgIds.length > 0) {
    return inOrgIds[0]!;
  }
  return "";
}

export async function setDashboardOrganizationId(
  organizationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = organizationId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(trimmed)) {
    return { ok: false, error: "Invalid organization id" };
  }
  const sessionId = await getDashboardSessionId();
  if (!sessionId) {
    return { ok: false, error: "Not signed in" };
  }
  const projectId = await getDashboardProjectId();
  const verify = await fetch(`${API_BASE_URL}/api/meta/projects`, {
    cache: "no-store",
    headers: sessionScopedMetaHeaders(sessionId, {
      projectId,
      organizationId: trimmed,
    }),
  });
  if (!verify.ok) {
    const t = await verify.text();
    return { ok: false, error: t.slice(0, 200) || "Could not verify organization" };
  }
  const verifyData = (await verify.json()) as { projects?: { id: string }[] };
  const nextProject = await resolveProjectCookieForOrganization(
    sessionId,
    trimmed,
    projectId,
    verifyData
  );
  if (!(await preferenceCookiesAllowedFromCookies())) {
    return { ok: false, error: await preferenceCookiesDeniedMessage() };
  }
  const c = await cookies();
  c.set(TELEMETRY_ORG_COOKIE, trimmed, cookieOpts);
  applyProjectCookieForOrganizationSwitch(c, projectId, nextProject);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function createOrganizationAction(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "Name is required" };
  }
  const orgPayload = await fetchDashboardOrganizationsPayload();
  if (!orgPayload.ok) {
    return {
      ok: false,
      error: "Could not load your organizations. Try again.",
    };
  }
  const isFirstOrganization = orgPayload.organizations.length === 0;
  const cookiesAllowed = await preferenceCookiesAllowedFromCookies();
  if (!cookiesAllowed && !isFirstOrganization) {
    return { ok: false, error: await preferenceCookiesDeniedMessage() };
  }
  const res = await dashboardApiFetch("/api/meta/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.slice(0, 120) }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 200) || "Could not create organization" };
  }
  const data = (await res.json()) as { id?: string };
  if (data.id && cookiesAllowed) {
    const orgId = data.id.toLowerCase();
    const c = await cookies();
    c.set(TELEMETRY_ORG_COOKIE, orgId, cookieOpts);
    const sessionId = await getDashboardSessionId();
    const projectId = await getDashboardProjectId();
    if (sessionId) {
      const nextProject = await resolveProjectCookieForOrganization(sessionId, orgId, projectId);
      applyProjectCookieForOrganizationSwitch(c, projectId, nextProject);
    }
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/settings/organization");
  return { ok: true };
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("slug") ?? "").trim();
  if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId) || !name) {
    return;
  }
  const body: { organizationId: string; name: string; slug?: string } = {
    organizationId,
    name: name.slice(0, 120),
  };
  if (slugRaw) {
    body.slug = slugRaw.slice(0, 120);
  }
  const res = await dashboardApiFetch("/api/meta/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return;
  }
  const data = (await res.json()) as { id?: string };
  if (data.id && (await preferenceCookiesAllowedFromCookies())) {
    const c = await cookies();
    c.set(TELEMETRY_PROJECT_COOKIE, data.id.toLowerCase(), cookieOpts);
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/settings/organization");
}

export async function inviteOrganizationMemberAction(
  _prev: { ok: boolean; error?: string; inviteUrl?: string } | null,
  formData: FormData
): Promise<
  | { ok: true; inviteUrl?: string }
  | { ok: false; error: string }
> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "VIEWER").trim();
  if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
    return { ok: false, error: "Invalid organization" };
  }
  if (!email.includes("@")) {
    return { ok: false, error: "Valid email is required" };
  }
  const res = await dashboardApiFetch(
    `/api/meta/organizations/${organizationId}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  const data = (await res.json()) as {
    status?: string;
    inviteUrl?: string;
  };
  revalidatePath("/dashboard/settings/team");
  if (data.status === "invited" && data.inviteUrl) {
    return { ok: true, inviteUrl: data.inviteUrl };
  }
  return { ok: true };
}

export async function updateOrganizationMemberRoleAction(
  organizationId: string,
  userId: string,
  role: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const oid = organizationId.trim();
  const uid = userId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(oid) || !/^[0-9a-f-]{36}$/i.test(uid)) {
    return { ok: false, error: "Invalid id" };
  }
  const res = await dashboardApiFetch(
    `/api/meta/organizations/${oid}/members/${uid}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }
  );
  if (res.status === 204) {
    revalidatePath("/dashboard/settings/team");
    return { ok: true };
  }
  const t = await res.text();
  return { ok: false, error: t.slice(0, 400) || res.statusText };
}

export type CreateApiKeyResult =
  | { ok: true; key: string; publicId: string; name: string | null }
  | { ok: false; error: string };

export async function createDashboardApiKey(
  _prev: CreateApiKeyResult | null,
  formData: FormData
): Promise<CreateApiKeyResult> {
  const raw = formData.get("name");
  const name =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim().slice(0, 120) : undefined;
  const allowedRaw = formData.get("allowedApp");
  const allowedApp =
    typeof allowedRaw === "string" && allowedRaw.trim() !== ""
      ? allowedRaw.trim().slice(0, 64)
      : undefined;
  const payload: { name?: string; allowedApp?: string } = {};
  if (name) payload.name = name;
  if (allowedApp) payload.allowedApp = allowedApp;
  const res = await dashboardApiFetch("/api/project/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  const data = (await res.json()) as {
    key: string;
    publicId: string;
    name: string | null;
  };
  revalidatePath("/dashboard/settings/keys");
  return {
    ok: true,
    key: data.key,
    publicId: data.publicId,
    name: data.name,
  };
}

/** One-click first key with a sensible default label (Settings empty state). */
export async function createFirstDashboardApiKey(): Promise<CreateApiKeyResult> {
  const formData = new FormData();
  formData.set("name", "Local development");
  return createDashboardApiKey(null, formData);
}

export async function archiveProjectAction(
  projectId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = projectId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return { ok: false, error: "Invalid project id" };
  }
  const res = await dashboardApiFetch(`/api/meta/projects/${id}/archive`, {
    method: "POST",
  });
  if (res.status === 204) {
    const current = (await getDashboardProjectId()).toLowerCase();
    if (current === id) {
      await resetDashboardProjectId();
    }
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/settings/organization");
    return { ok: true };
  }
  const t = await res.text();
  return { ok: false, error: t.slice(0, 400) || res.statusText };
}

export async function archiveOrganizationAction(
  organizationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const oid = organizationId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(oid)) {
    return { ok: false, error: "Invalid organization id" };
  }
  const res = await dashboardApiFetch(`/api/meta/organizations/${oid}/archive`, {
    method: "POST",
  });
  if (res.status === 204) {
    const c = await cookies();
    c.delete(TELEMETRY_ORG_COOKIE);
    await resetDashboardProjectId();
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/settings/organization");
    return { ok: true };
  }
  const t = await res.text();
  return { ok: false, error: t.slice(0, 400) || res.statusText };
}

export async function createBillingCheckoutAction(
  organizationId: string,
  planTier: "PRO" | "BUSINESS"
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const oid = organizationId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(oid)) {
    return { ok: false, error: "Invalid organization id" };
  }
  const res = await dashboardApiFetch(
    `/api/meta/organizations/${oid}/billing/checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planTier }),
    },
    { organizationIdOverride: oid }
  );
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    return { ok: false, error: "No checkout URL returned" };
  }
  return { ok: true, url: data.url };
}

export async function createBillingPortalAction(
  organizationId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const oid = organizationId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(oid)) {
    return { ok: false, error: "Invalid organization id" };
  }
  const res = await dashboardApiFetch(
    `/api/meta/organizations/${oid}/billing/portal`,
    { method: "POST" },
    { organizationIdOverride: oid }
  );
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    return { ok: false, error: "No portal URL returned" };
  }
  return { ok: true, url: data.url };
}

export async function setErrorResolvedAction(
  errorGroupId: string,
  resolved: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await dashboardApiFetch(`/api/errors/${errorGroupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  revalidatePath(`/dashboard/errors/${errorGroupId}`);
  revalidatePath("/dashboard/errors");
  return { ok: true };
}

export async function revokeDashboardApiKey(
  publicId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = publicId.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return { ok: false, error: "Invalid key id" };
  }
  const res = await dashboardApiFetch(`/api/project/api-keys/${id}/revoke`, {
    method: "POST",
  });
  if (res.status === 204) {
    revalidatePath("/dashboard/settings/keys");
    return { ok: true };
  }
  const t = await res.text();
  return { ok: false, error: t.slice(0, 400) || res.statusText };
}

export async function saveNotificationPreferencesAction(
  preferences: NotificationPreferences
): Promise<
  | { ok: true; preferences: NotificationPreferences }
  | { ok: false; error: string }
> {
  const res = await dashboardApiFetch("/api/meta/notification-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  try {
    const data = (await res.json()) as { preferences?: unknown };
    revalidatePath("/dashboard/settings/notifications");
    revalidatePath("/dashboard", "layout");
    return { ok: true, preferences: parseNotificationPreferences(data.preferences) };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}

export async function saveDashboardPreferencesAction(
  preferences: DashboardPreferences
): Promise<
  | { ok: true; preferences: DashboardPreferences }
  | { ok: false; error: string }
> {
  const res = await dashboardApiFetch("/api/meta/dashboard-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  try {
    const data = (await res.json()) as { preferences?: unknown };
    revalidatePath("/dashboard/settings/preferences");
    return { ok: true, preferences: parseDashboardPreferences(data.preferences) };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}

async function notificationApiFetchOptions(): Promise<
  Pick<DashboardApiFetchOptions, "projectIdOverride" | "organizationIdOverride">
> {
  const { effectiveProjectId, resolvedOrgId } = await getDashboardWorkspaceForRequest();
  return {
    projectIdOverride: effectiveProjectId === "" ? undefined : effectiveProjectId,
    organizationIdOverride: resolvedOrgId ?? undefined,
  };
}

export async function markNotificationsReadAction(
  ids: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = ids.map((id) => id.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return { ok: false, error: "No notification ids" };
  }
  const res = await dashboardApiFetch(
    "/api/meta/notifications/read",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: trimmed }),
    },
    await notificationApiFetchOptions()
  );
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const res = await dashboardApiFetch(
    "/api/meta/notifications/read",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    },
    await notificationApiFetchOptions()
  );
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function saveProjectAlertSettingsAction(
  settings: ProjectAlertSettings
): Promise<
  | { ok: true; settings: ProjectAlertSettings }
  | { ok: false; error: string }
> {
  const res = await dashboardApiFetch("/api/project/alert-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  try {
    const data = (await res.json()) as { settings?: unknown };
    revalidatePath("/dashboard/alerts");
    revalidatePath("/dashboard", "layout");
    return { ok: true, settings: parseProjectAlertSettings(data.settings) };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}

export type SourceMapArtifactSummaryRow = {
  id: string;
  app: string;
  release: string;
  bundleUrl: string;
  sha256: string;
  sizeBytes: number;
  uploadedAt: string;
};

export async function listProjectSourceMapsAction(
  app: string,
  release: string
): Promise<
  | { ok: true; artifacts: SourceMapArtifactSummaryRow[] }
  | { ok: false; error: string }
> {
  const appLabel = app.trim();
  const releaseLabel = release.trim();
  if (!appLabel || !releaseLabel) {
    return { ok: false, error: "Enter both app and release to list uploaded maps." };
  }
  const params = new URLSearchParams({ app: appLabel, release: releaseLabel });
  const res = await dashboardApiFetch(`/api/project/source-maps?${params.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: t.slice(0, 400) || res.statusText };
  }
  try {
    const data = (await res.json()) as { artifacts?: SourceMapArtifactSummaryRow[] };
    return { ok: true, artifacts: data.artifacts ?? [] };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}

async function readApiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { error?: string };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  } catch {
    /* ignore */
  }
  return text.slice(0, 400) || res.statusText;
}

export async function fetchAuthSessionsAction(): Promise<FetchAuthSessionsResult> {
  return fetchAuthSessions();
}

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await dashboardApiFetch(
    "/api/auth/change-password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    },
    { omitOrganizationHeader: true, omitProjectHeader: true }
  );
  if (!res.ok) {
    return { ok: false, error: await readApiError(res) };
  }
  revalidatePath("/dashboard/settings/security");
  return { ok: true };
}

export async function revokeAuthSessionAction(
  sessionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return { ok: false, error: "Session id required" };
  }
  const res = await dashboardApiFetch(
    `/api/auth/sessions/${encodeURIComponent(trimmed)}`,
    { method: "DELETE" },
    { omitOrganizationHeader: true, omitProjectHeader: true }
  );
  if (!res.ok) {
    return { ok: false, error: await readApiError(res) };
  }
  revalidatePath("/dashboard/settings/security");
  return { ok: true };
}

export async function revokeOtherAuthSessionsAction(): Promise<
  { ok: true; revoked: number } | { ok: false; error: string }
> {
  const res = await dashboardApiFetch(
    "/api/auth/sessions/others",
    { method: "DELETE" },
    { omitOrganizationHeader: true, omitProjectHeader: true }
  );
  if (!res.ok) {
    return { ok: false, error: await readApiError(res) };
  }
  try {
    const data = (await res.json()) as { revoked?: number };
    revalidatePath("/dashboard/settings/security");
    return { ok: true, revoked: typeof data.revoked === "number" ? data.revoked : 0 };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}
