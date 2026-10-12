"use server";

import { apiFetch } from "@/lib/api-fetch";
import { API_BASE_URL } from "@/lib/api-url";

export type MarketingSubscribeResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function subscribeToProductUpdates(
  email: string
): Promise<MarketingSubscribeResult> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE_URL}/api/marketing/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Try again in a moment.",
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? "Something went wrong. Try again.",
    };
  }

  return {
    ok: true,
    message: data.message ?? "You're subscribed to product updates.",
  };
}

export type MarketingUnsubscribeResult =
  | { ok: true; message: string; alreadyUnsubscribed: boolean }
  | { ok: false; error: string };

export async function unsubscribeFromProductUpdates(
  token: string
): Promise<MarketingUnsubscribeResult> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE_URL}/api/marketing/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Try again in a moment.",
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    alreadyUnsubscribed?: boolean;
  };

  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? "Invalid or expired unsubscribe link.",
    };
  }

  return {
    ok: true,
    message: data.message ?? "You have been unsubscribed from product updates.",
    alreadyUnsubscribed: Boolean(data.alreadyUnsubscribed),
  };
}
