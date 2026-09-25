/**
 * Optional transactional email. When `RESEND_API_KEY` and `TELEMETRY_EMAIL_FROM` are set,
 * sends via Resend API. Otherwise logs in non-production and returns
 * `{ sent: false, error: "email_not_configured" }` in production (with a one-time warn).
 */
import {
  emailBrandLogoAttachment,
  htmlNeedsBrandLogoAttachment,
} from "./email-brand-logo.js";

export type TransactionalEmailAttachment = {
  /** Base64-encoded file contents (Resend `content`). */
  content: string;
  filename: string;
  /** Inline CID referenced as `cid:<id>` in HTML. */
  content_id?: string;
  content_type?: string;
  /** Remote URL alternative to `content` (Resend fetches at send time). */
  path?: string;
};

/** Strip CR/LF before logging (CodeQL js/log-injection: replace /\n|\r/g with ""). */
function sanitizeForLog(value: string): string {
  return value.replace(/\n|\r/g, "").slice(0, 500);
}

export const EMAIL_NOT_CONFIGURED = "email_not_configured";

/** Env var *names* required for Resend. Values are never logged. */
export function missingTransactionalEmailEnvNames(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const missing: string[] = [];
  if (!env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (!env.TELEMETRY_EMAIL_FROM?.trim()) missing.push("TELEMETRY_EMAIL_FROM");
  return missing;
}

export function isTransactionalEmailConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return missingTransactionalEmailEnvNames(env).length === 0;
}

let loggedMissingConfig = false;

/** @internal test helper */
export function resetTransactionalEmailConfigWarningForTests(): void {
  loggedMissingConfig = false;
}

/**
 * Log once per process when Resend env is missing. Never logs secret values.
 * Safe to call from cron sweeps and the API boot path.
 */
export function warnIfTransactionalEmailNotConfigured(
  env: NodeJS.ProcessEnv = process.env,
  context: { job?: string } = {}
): boolean {
  const missing = missingTransactionalEmailEnvNames(env);
  if (missing.length === 0) return true;
  if (!loggedMissingConfig) {
    loggedMissingConfig = true;
    console.warn(
      JSON.stringify({
        ok: false,
        job: context.job ?? "transactional-email",
        reason: EMAIL_NOT_CONFIGURED,
        missing,
        message:
          "Transactional email is not configured. Set RESEND_API_KEY and TELEMETRY_EMAIL_FROM on this process (the API service and the alert-rules-evaluator cron each need their own copy).",
      })
    );
  }
  return false;
}

export async function sendTransactionalEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  /** Extra Resend attachments; brand logo CID is added automatically when HTML needs it. */
  attachments?: TransactionalEmailAttachment[];
}): Promise<{ sent: boolean; devLogged?: boolean; status?: number; error?: string }> {
  if (!isTransactionalEmailConfigured()) {
    warnIfTransactionalEmailNotConfigured();
    if (process.env.NODE_ENV !== "production") {
      const to = Array.isArray(opts.to)
        ? opts.to.map(sanitizeForLog).join(", ")
        : sanitizeForLog(opts.to);
      console.info(
        "[email:dev]",
        to,
        sanitizeForLog(opts.subject),
        sanitizeForLog(opts.html.slice(0, 200))
      );
      return { sent: false, devLogged: true, error: EMAIL_NOT_CONFIGURED };
    }
    return { sent: false, error: EMAIL_NOT_CONFIGURED };
  }

  const apiKey = process.env.RESEND_API_KEY!.trim();
  const from = process.env.TELEMETRY_EMAIL_FROM!.trim();

  const attachments: TransactionalEmailAttachment[] = [...(opts.attachments ?? [])];
  const brandLogo = emailBrandLogoAttachment();
  if (
    htmlNeedsBrandLogoAttachment(opts.html) &&
    !attachments.some((a) => a.content_id === brandLogo.content_id)
  ) {
    attachments.push(brandLogo);
  }

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    console.warn("[email] Resend request failed:", message);
    return { sent: false, error: message };
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text) as { message?: string };
      if (json.message) message = json.message;
    } catch {
      // keep raw body
    }
    console.warn("[email] Resend failed:", res.status, message);
    return { sent: false, status: res.status, error: message };
  }
  return { sent: true };
}
