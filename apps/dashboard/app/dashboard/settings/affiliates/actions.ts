"use server";

import { revalidatePath } from "next/cache";
import { affiliateAdminFetch } from "@/lib/affiliate-admin-server";

export type AdminActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<AdminActionResult<T>> {
  let res: Response;
  try {
    res = await affiliateAdminFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: "Could not reach the API." };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error =
      res.status === 401 || res.status === 403
        ? "You don't have access to affiliate admin."
        : typeof data.error === "string"
          ? data.error
          : `Request failed (${res.status})`;
    return { ok: false, error, code: typeof data.code === "string" ? data.code : undefined };
  }
  revalidatePath("/dashboard/settings/affiliates", "layout");
  return { ok: true, ...(data as T) };
}

function requireUuid(id: string): string | null {
  const trimmed = id.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export async function approveAffiliateApplicationAction(input: {
  applicationId: string;
  code: string;
  note?: string;
}): Promise<AdminActionResult<{ affiliateId: string; code: string }>> {
  const id = requireUuid(input.applicationId);
  if (!id) return { ok: false, error: "Invalid application id" };
  return call(`/api/meta/affiliates/applications/${id}/approve`, "POST", {
    code: input.code,
    note: input.note ?? "",
  });
}

export async function rejectAffiliateApplicationAction(input: {
  applicationId: string;
  note?: string;
}): Promise<AdminActionResult> {
  const id = requireUuid(input.applicationId);
  if (!id) return { ok: false, error: "Invalid application id" };
  return call(`/api/meta/affiliates/applications/${id}/reject`, "POST", { note: input.note ?? "" });
}

export async function createAffiliateAction(input: {
  name: string;
  email: string;
  code: string;
}): Promise<AdminActionResult<{ id: string; code: string }>> {
  return call("/api/meta/affiliates", "POST", {
    name: input.name,
    email: input.email.trim() ? input.email : null,
    code: input.code.trim() ? input.code : null,
  });
}

export async function setAffiliateStateAction(input: {
  affiliateId: string;
  state: "active" | "disabled";
}): Promise<AdminActionResult> {
  const id = requireUuid(input.affiliateId);
  if (!id) return { ok: false, error: "Invalid affiliate id" };
  if (input.state !== "active" && input.state !== "disabled") {
    return { ok: false, error: "Invalid state" };
  }
  return call(`/api/meta/affiliates/${id}`, "PATCH", { state: input.state });
}

export async function recordAffiliatePayoutAction(input: {
  affiliateId: string;
  commissionIds: string[];
  amountCents: number;
  paidAt?: string;
  referenceNote?: string;
  idempotencyKey: string;
}): Promise<AdminActionResult<{ payoutId: string; amountCents: number; idempotent: boolean }>> {
  const id = requireUuid(input.affiliateId);
  if (!id) return { ok: false, error: "Invalid affiliate id" };
  return call(`/api/meta/affiliates/${id}/payouts`, "POST", {
    commissionIds: input.commissionIds,
    amountCents: input.amountCents,
    paidAt: input.paidAt || undefined,
    referenceNote: input.referenceNote ?? "",
    idempotencyKey: input.idempotencyKey,
  });
}

export async function resolveNeedsAttentionAction(input: {
  organizationId: string;
  affiliateId: string;
  reason: string;
}): Promise<AdminActionResult<{ toStatus: string }>> {
  const orgId = requireUuid(input.organizationId);
  if (!orgId) return { ok: false, error: "Invalid organization id" };
  return call(`/api/meta/affiliates/organizations/${orgId}/resolve-needs-attention`, "POST", {
    reason: input.reason,
    affiliateId: input.affiliateId,
  });
}
