import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  isTransactionalEmailConfigured,
  sendTransactionalEmail,
} from "../lib/email.js";

const CONTACT_INBOX =
  process.env.CONTACT_INBOX_EMAIL?.trim() || "info@telemetry-tracker.com";

const TOPICS = new Set(["general", "support", "security", "business", "other"]);

const TOPIC_LABELS: Record<string, string> = {
  general: "General",
  support: "Support",
  security: "Security",
  business: "Business",
  other: "Other",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Linear-time shape check (avoids CodeQL polynomial-ReDoS email regexes). */
function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 255) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain) return false;
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

function stripHeaderUnsafeChars(value: string): string {
  return value.replace(/[\r\n\0]/g, "");
}

type ContactBody = {
  name?: string;
  email?: string;
  company?: string;
  topic?: string;
  message?: string;
};

function parseContactBody(body: ContactBody) {
  const name = stripHeaderUnsafeChars(
    typeof body.name === "string" ? body.name.trim() : ""
  );
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "general";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Required";
  else if (name.length > 100) errors.name = "Too long";
  if (!email) errors.email = "Required";
  else if (!isValidEmail(email)) errors.email = "Invalid email";
  if (company.length > 120) errors.company = "Too long";
  if (message.length < 10) errors.message = "Tell us a bit more";
  else if (message.length > 2000) errors.message = "Too long";
  if (!TOPICS.has(topic)) errors.topic = "Invalid topic";

  return { name, email, company, topic, message, errors };
}

function contactDeliveryError(result: { status?: number; error?: string }): string {
  const resendMessage = result.error?.toLowerCase() ?? "";
  if (
    resendMessage.includes("verify a domain") ||
    resendMessage.includes("domain is not") ||
    resendMessage.includes("resend.dev")
  ) {
    return (
      `Email delivery is blocked by Resend: verify telemetry-tracker.com (or your sending domain) in the Resend dashboard ` +
      `and set TELEMETRY_EMAIL_FROM to an address on that domain (e.g. Telemetry <info@telemetry-tracker.com>). ` +
      `Until then, email ${CONTACT_INBOX} directly.`
    );
  }
  if (process.env.NODE_ENV !== "production" && result.error) {
    return `Could not deliver your message (${result.error}). Email ${CONTACT_INBOX} directly.`;
  }
  return `Could not deliver your message. Try emailing ${CONTACT_INBOX} directly.`;
}

export async function contactRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  app.post("/contact", async (request, reply) => {
    const parsed = parseContactBody((request.body ?? {}) as ContactBody);
    if (Object.keys(parsed.errors).length > 0) {
      return reply.status(400).send({ error: "Validation failed", fields: parsed.errors });
    }

    const { name, email, company, topic, message } = parsed;
    const topicLabel = TOPIC_LABELS[topic] ?? topic;

    if (!isTransactionalEmailConfigured()) {
      if (process.env.NODE_ENV !== "production") {
        console.info("[contact:dev]", { name, email, company, topic, message });
        return reply.send({
          ok: true,
          devLogged: true,
          inboxSent: false,
        });
      }
      return reply.status(503).send({
        error: `Contact email is not configured. Email us directly at ${CONTACT_INBOX}.`,
      });
    }

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeCompany = company ? escapeHtml(company) : "";
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");

    const inboxHtml = [
      `<p><strong>Topic:</strong> ${escapeHtml(topicLabel)}</p>`,
      `<p><strong>Name:</strong> ${safeName}</p>`,
      `<p><strong>Email:</strong> ${safeEmail}</p>`,
      safeCompany ? `<p><strong>Company:</strong> ${safeCompany}</p>` : "",
      `<p><strong>Message:</strong></p><p>${safeMessage}</p>`,
    ]
      .filter(Boolean)
      .join("");

    const inboxResult = await sendTransactionalEmail({
      to: CONTACT_INBOX,
      replyTo: email,
      subject: `Telemetry Tracker — ${topicLabel} from ${name}`,
      html: inboxHtml,
    });

    if (!inboxResult.sent) {
      return reply.status(502).send({
        error: contactDeliveryError(inboxResult),
      });
    }

    return reply.send({
      ok: true,
      inboxSent: inboxResult.sent,
    });
  });
}
