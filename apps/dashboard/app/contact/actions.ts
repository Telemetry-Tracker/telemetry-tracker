"use server";

import { apiFetch } from "@/lib/api-fetch";
import { API_BASE_URL } from "@/lib/api-url";

export type ContactTopic = "general" | "support" | "security" | "business" | "other";

export type ContactFormInput = {
  name: string;
  email: string;
  company: string;
  topic: ContactTopic;
  message: string;
};

export type ContactSubmitResult =
  | {
      ok: true;
      inboxSent: boolean;
      devLogged?: boolean;
    }
  | {
      ok: false;
      error: string;
      fields?: Partial<Record<keyof ContactFormInput, string>>;
    };

export async function submitContactForm(
  input: ContactFormInput
): Promise<ContactSubmitResult> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE_URL}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Check your connection or email info@telemetry-tracker.com directly.",
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    fields?: Partial<Record<keyof ContactFormInput, string>>;
    inboxSent?: boolean;
    devLogged?: boolean;
  };

  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? "Something went wrong. Try again or email info@telemetry-tracker.com directly.",
      fields: data.fields,
    };
  }

  return {
    ok: true,
    inboxSent: Boolean(data.inboxSent),
    devLogged: data.devLogged,
  };
}
