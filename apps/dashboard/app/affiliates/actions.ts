"use server";

import { headers } from "next/headers";
import { API_BASE_URL } from "@/lib/api-url";
import { clientIpFromHeaders } from "@/lib/request-client-ip";
import { AFFILIATE_TERMS_VERSION } from "@/lib/affiliate-program";

export type AffiliateApplicationFormInput = {
  name: string;
  email: string;
  websiteUrl: string;
  promotionPlan: string;
  acceptTerms: boolean;
  /** Honeypot — hidden from people; bots fill it. */
  company_website: string;
};

export type AffiliateApplicationField = "name" | "email" | "websiteUrl" | "promotionPlan" | "acceptTerms";

export type AffiliateApplicationSubmitResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fields?: Partial<Record<AffiliateApplicationField, string>> };

const FALLBACK_ERROR = "Something went wrong. Try again in a moment or use the contact page.";

export async function submitAffiliateApplication(
  input: AffiliateApplicationFormInput
): Promise<AffiliateApplicationSubmitResult> {
  const requestHeaders = await headers();
  const clientIp = clientIpFromHeaders(requestHeaders);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/affiliate-applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientIp ? { "x-tt-client-ip": clientIp } : {}),
      },
      body: JSON.stringify({
        name: String(input.name ?? ""),
        email: String(input.email ?? ""),
        websiteUrl: String(input.websiteUrl ?? ""),
        promotionPlan: String(input.promotionPlan ?? ""),
        acceptTerms: input.acceptTerms === true,
        company_website: String(input.company_website ?? ""),
        termsVersion: AFFILIATE_TERMS_VERSION,
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    fields?: Partial<Record<AffiliateApplicationField, string>>;
  };

  if (!res.ok) {
    if (res.status === 404) {
      return { ok: false, error: "Applications are not open right now." };
    }
    return { ok: false, error: data.error ?? FALLBACK_ERROR, fields: data.fields };
  }
  return { ok: true, message: data.message ?? "Thanks — your application is in." };
}
