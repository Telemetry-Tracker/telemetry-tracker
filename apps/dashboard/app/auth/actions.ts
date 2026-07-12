"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE_URL } from "@/lib/api-url";
import { clearPreferenceCookies, preferenceCookiesAllowedFromCookies, applyCookieConsentFromForm } from "@/lib/cookie-consent-server";
import { TELEMETRY_ORG_COOKIE } from "@/lib/dashboard-org";
import {
  TELEMETRY_PROJECT_COOKIE,
  TELEMETRY_SESSION_COOKIE,
  getDashboardSessionId,
} from "@/lib/dashboard-project";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const PROJECT_MAX_AGE = 60 * 60 * 24 * 400;

async function fetchFirstProjectAndOrg(sessionId: string): Promise<{
  projectId?: string;
  organizationId?: string;
}> {
  const res = await fetch(`${API_BASE_URL}/api/meta/projects`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${sessionId}` },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as {
    projects?: { id: string; organizationId?: string }[];
  };
  const p = data.projects?.[0];
  if (!p) return {};
  return {
    projectId: p.id,
    organizationId: p.organizationId,
  };
}

/** First org the user belongs to (matches `GET /api/meta/organizations` order) — use when there are no projects yet. */
async function fetchFirstOrganizationId(sessionId: string): Promise<string | undefined> {
  const res = await fetch(`${API_BASE_URL}/api/meta/organizations`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${sessionId}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { organizations?: { id: string }[] };
  const id = data.organizations?.[0]?.id;
  return typeof id === "string" ? id : undefined;
}

function resolveBootstrapOrganizationId(
  fromAuthResponse: unknown,
  fromProject: string | undefined,
  fromOrgList: string | undefined
): string | undefined {
  if (typeof fromAuthResponse === "string" && fromAuthResponse.trim() !== "") {
    return fromAuthResponse.trim();
  }
  return fromProject ?? fromOrgList;
}

function cookieBase() {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}

async function clientUserAgentHeader(): Promise<Record<string, string>> {
  const userAgent = (await headers()).get("user-agent");
  return userAgent ? { "User-Agent": userAgent.slice(0, 512) } : {};
}

async function setBootstrapPreferenceCookies(
  c: Awaited<ReturnType<typeof cookies>>,
  projectId: string | undefined,
  organizationId: string | undefined
): Promise<void> {
  if (!(await preferenceCookiesAllowedFromCookies())) {
    await clearPreferenceCookies();
    return;
  }
  if (projectId) {
    c.set(TELEMETRY_PROJECT_COOKIE, projectId, {
      ...cookieBase(),
      maxAge: PROJECT_MAX_AGE,
    });
  }
  if (organizationId) {
    c.set(TELEMETRY_ORG_COOKIE, organizationId.toLowerCase(), {
      ...cookieBase(),
      maxAge: PROJECT_MAX_AGE,
    });
  } else {
    c.set(TELEMETRY_ORG_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  }
}

export async function login(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { ok: false, error: "Email and password are required" };
  }
  await applyCookieConsentFromForm(formData);
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await clientUserAgentHeader()),
    },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    sessionId?: string;
    organizationId?: string | null;
  };
  if (!res.ok) {
    return { ok: false, error: data.error ?? "Login failed" };
  }
  const sessionId = data.sessionId;
  if (!sessionId) {
    return { ok: false, error: "Invalid response from server" };
  }
  const c = await cookies();
  c.set(TELEMETRY_SESSION_COOKIE, sessionId, {
    ...cookieBase(),
    maxAge: SESSION_MAX_AGE,
  });
  const { projectId, organizationId: orgFromProject } =
    await fetchFirstProjectAndOrg(sessionId);
  let organizationId = resolveBootstrapOrganizationId(
    data.organizationId,
    orgFromProject,
    undefined
  );
  if (!organizationId) {
    organizationId = await fetchFirstOrganizationId(sessionId);
  }
  await setBootstrapPreferenceCookies(c, projectId, organizationId);
  return { ok: true };
}

export async function register(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayNameRaw = String(formData.get("displayName") ?? "").trim();
  const displayName = displayNameRaw ? displayNameRaw.slice(0, 120) : undefined;
  const inviteToken = String(formData.get("inviteToken") ?? "").trim();
  const marketingOptIn = formData.get("marketingOptIn") === "yes";
  if (formData.get("termsAccepted") !== "yes") {
    return {
      ok: false,
      error: "Please accept the Terms of Service and Privacy Policy to continue.",
    };
  }
  if (!email || !password) {
    return { ok: false, error: "Email and password are required" };
  }
  await applyCookieConsentFromForm(formData);
  const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await clientUserAgentHeader()),
    },
    body: JSON.stringify({
      email,
      password,
      displayName,
      marketingOptIn,
      ...(inviteToken ? { inviteToken } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    sessionId?: string;
    organizationId?: string | null;
  };
  if (!res.ok) {
    return { ok: false, error: data.error ?? "Registration failed" };
  }
  const sessionId = data.sessionId;
  if (!sessionId) {
    return { ok: false, error: "Invalid response from server" };
  }
  const c = await cookies();
  c.set(TELEMETRY_SESSION_COOKIE, sessionId, {
    ...cookieBase(),
    maxAge: SESSION_MAX_AGE,
  });
  const { projectId, organizationId: orgFromProject } =
    await fetchFirstProjectAndOrg(sessionId);
  let organizationId = resolveBootstrapOrganizationId(
    data.organizationId,
    orgFromProject,
    undefined
  );
  if (!organizationId) {
    organizationId = await fetchFirstOrganizationId(sessionId);
  }
  await setBootstrapPreferenceCookies(c, projectId, organizationId);
  return { ok: true };
}

export async function logout(): Promise<void> {
  const sid = await getDashboardSessionId();
  if (sid) {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sid}` },
    });
  }
  const c = await cookies();
  c.set(TELEMETRY_SESSION_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  c.set(TELEMETRY_ORG_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  c.set(TELEMETRY_PROJECT_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

export async function requestPasswordReset(
  formData: FormData
): Promise<
  | { ok: true; message: string; resetUrl?: string }
  | { ok: false; error: string }
> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) {
    return { ok: false, error: "Valid email is required" };
  }
  const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    resetUrl?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error ?? "Request failed" };
  }
  return {
    ok: true,
    message: data.message ?? "If that email exists, a reset link was sent.",
    resetUrl: data.resetUrl,
  };
}

export async function resetPassword(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!token) {
    return { ok: false, error: "Missing reset token" };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { ok: false, error: data.error ?? "Reset failed" };
  }
  return { ok: true };
}
