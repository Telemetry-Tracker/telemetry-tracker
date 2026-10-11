/**
 * Server-only reads for the founder affiliate admin. The API enforces the gate
 * (404 flag off / 401 no session / 403 not on AFFILIATE_ADMIN_EMAILS); we never decide access here.
 */
import { dashboardApiFetchFromCookies } from "@/lib/dashboard-api";
import { isAffiliateProgramEnabled } from "@/lib/affiliate-program";
import type {
  AffiliateApplicationFilter,
  AffiliateApplicationRow,
  AffiliateDetail,
  AffiliateListRow,
} from "@/lib/affiliate-admin-types";

const SESSION_ONLY = { omitOrganizationHeader: true, omitProjectHeader: true } as const;

export function affiliateAdminFetch(path: string, init?: RequestInit): Promise<Response> {
  return dashboardApiFetchFromCookies(path, init, SESSION_ONLY);
}

/** True only when the API confirms the session user is an affiliate admin. */
export async function hasAffiliateAdminAccess(): Promise<boolean> {
  if (!isAffiliateProgramEnabled()) return false;
  try {
    const res = await affiliateAdminFetch("/api/meta/affiliates/access");
    return res.ok;
  } catch {
    return false;
  }
}

type Loaded<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await affiliateAdminFetch(path);
  } catch {
    return { ok: false, status: 503, error: "Could not reach the API." };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: body.error ?? `Request failed (${res.status})` };
  }
  return { ok: true, data: (await res.json()) as T };
}

export function loadAffiliateApplications(status: AffiliateApplicationFilter) {
  return load<{ status: AffiliateApplicationFilter; applications: AffiliateApplicationRow[] }>(
    `/api/meta/affiliates/applications?status=${encodeURIComponent(status)}`
  );
}

export function loadAffiliates() {
  return load<{ affiliates: AffiliateListRow[] }>("/api/meta/affiliates");
}

export function loadAffiliateDetail(affiliateId: string) {
  return load<AffiliateDetail>(`/api/meta/affiliates/${encodeURIComponent(affiliateId)}`);
}

/** Access-denied statuses that should render as "not found" (no hint the page exists). */
export function isAffiliateAdminDenied(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}
