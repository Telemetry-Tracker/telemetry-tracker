import { dashboardApiFetch } from "@/lib/dashboard-api";

export type DashboardAuthSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  deviceBrowser: string | null;
  deviceOs: string | null;
  current: boolean;
};

export type FetchAuthSessionsResult =
  | { ok: true; sessions: DashboardAuthSession[] }
  | { ok: false; error: string };

export async function fetchAuthSessions(): Promise<FetchAuthSessionsResult> {
  const res = await dashboardApiFetch("/api/auth/sessions", undefined, {
    omitOrganizationHeader: true,
    omitProjectHeader: true,
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const data = JSON.parse(text) as { error?: string };
      if (typeof data.error === "string" && data.error.trim()) {
        return { ok: false, error: data.error };
      }
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `Could not load sessions (${res.status}): ${text.slice(0, 200)}`,
    };
  }
  try {
    const data = (await res.json()) as { sessions?: DashboardAuthSession[] };
    return {
      ok: true,
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
    };
  } catch {
    return { ok: false, error: "Invalid response from server" };
  }
}
