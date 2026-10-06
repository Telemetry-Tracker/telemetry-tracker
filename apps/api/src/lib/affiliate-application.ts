/**
 * Public affiliate program applications (/affiliates form → founder review).
 * No account needed. Applicants are never emailed; an optional founder notification is
 * sent only when AFFILIATE_APPLICATION_NOTIFY_EMAILS and transactional email are configured.
 */
import { isIP } from "node:net";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";
import { createAffiliate, suggestUniqueAffiliateCode } from "./affiliate-management.js";
import { dashboardOriginOrNull } from "./dashboard-origin.js";
import { isTransactionalEmailConfigured, sendTransactionalEmail } from "./email.js";

export const AFFILIATE_APPLICATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type AffiliateApplicationStatus = (typeof AFFILIATE_APPLICATION_STATUSES)[number];

export const APPLICATION_NAME_MAX = 100;
export const APPLICATION_EMAIL_MAX = 254;
export const APPLICATION_URL_MAX = 300;
export const APPLICATION_PROMOTION_MIN = 20;
export const APPLICATION_PROMOTION_MAX = 1000;
export const APPLICATION_REVIEW_NOTE_MAX = 500;
export const APPLICATION_TERMS_VERSION_MAX = 32;

/** Form field that real users never see or fill (bots do). */
export const APPLICATION_HONEYPOT_FIELD = "company_website";

/** Header the dashboard server action uses to forward the visitor IP for per-IP rate limiting. */
export const CLIENT_IP_FORWARD_HEADER = "x-tt-client-ip";

export const DEFAULT_APPLICATION_RATE_LIMIT_MAX = 5;
export const APPLICATION_RATE_LIMIT_WINDOW_MS = 10 * 60_000;
export const DEFAULT_APPLICATIONS_MAX_PER_HOUR = 30;

function positiveIntEnv(key: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-IP submissions per {@link APPLICATION_RATE_LIMIT_WINDOW_MS}. */
export function applicationRateLimitMax(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv(
    "RATE_LIMIT_AFFILIATE_APPLICATION_MAX",
    DEFAULT_APPLICATION_RATE_LIMIT_MAX,
    env
  );
}

/** Global safety cap on new applications per rolling hour (all IPs). */
export function applicationsMaxPerHour(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv("AFFILIATE_APPLICATIONS_MAX_PER_HOUR", DEFAULT_APPLICATIONS_MAX_PER_HOUR, env);
}

/**
 * Rate-limit key: the visitor IP forwarded by the dashboard server action when it is a
 * syntactically valid IP, else the socket IP. The global hourly cap backstops spoofed headers.
 */
export function applicationRateLimitKey(request: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  const raw = request.headers[CLIENT_IP_FORWARD_HEADER];
  const forwarded = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (forwarded && forwarded.length <= 45 && isIP(forwarded) !== 0) {
    return `affiliate-application:${forwarded}`;
  }
  return `affiliate-application:${request.ip}`;
}

export type AffiliateApplicationInput = {
  name: string;
  email: string;
  websiteUrl: string;
  promotionPlan: string;
  termsVersion: string;
};

export type AffiliateApplicationField = "name" | "email" | "websiteUrl" | "promotionPlan" | "acceptTerms";

export type ParseApplicationResult =
  | { ok: true; value: AffiliateApplicationInput }
  | { ok: false; fields: Partial<Record<AffiliateApplicationField, string>> };

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanSingleLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHARS_RE, "").replace(/[\r\n\t]+/g, " ").trim();
}

function cleanMultiline(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHARS_RE, "").replace(/\r\n?/g, "\n").trim();
}

/** Linear-time shape check (same approach as the contact form; avoids ReDoS-prone regexes). */
export function isPlausibleEmail(email: string): boolean {
  if (email.length === 0 || email.length > APPLICATION_EMAIL_MAX) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain) return false;
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

/** http(s) URL with a dotted hostname and no credentials. Returns the normalized href. */
export function normalizeApplicantUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > APPLICATION_URL_MAX) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  const href = url.toString();
  return href.length <= APPLICATION_URL_MAX ? href : null;
}

export function isHoneypotTripped(body: Record<string, unknown>): boolean {
  const value = body[APPLICATION_HONEYPOT_FIELD];
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null && value !== false;
}

export function parseAffiliateApplicationInput(body: Record<string, unknown>): ParseApplicationResult {
  const name = cleanSingleLine(body.name);
  const email = cleanSingleLine(body.email).toLowerCase();
  const websiteRaw = cleanSingleLine(body.websiteUrl);
  const promotionPlan = cleanMultiline(body.promotionPlan);
  const termsVersionRaw = cleanSingleLine(body.termsVersion);
  const fields: Partial<Record<AffiliateApplicationField, string>> = {};

  if (name.length < 2) fields.name = "Enter your name";
  else if (name.length > APPLICATION_NAME_MAX) fields.name = "Too long";

  if (!email) fields.email = "Required";
  else if (!isPlausibleEmail(email)) fields.email = "Enter a valid email address";

  const websiteUrl = websiteRaw ? normalizeApplicantUrl(websiteRaw) : null;
  if (!websiteRaw) fields.websiteUrl = "Required";
  else if (!websiteUrl) fields.websiteUrl = "Enter a valid http(s) URL";

  if (promotionPlan.length < APPLICATION_PROMOTION_MIN) {
    fields.promotionPlan = `Tell us a bit more (at least ${APPLICATION_PROMOTION_MIN} characters)`;
  } else if (promotionPlan.length > APPLICATION_PROMOTION_MAX) {
    fields.promotionPlan = `Keep it under ${APPLICATION_PROMOTION_MAX} characters`;
  }

  if (body.acceptTerms !== true) fields.acceptTerms = "You must accept the affiliate terms";

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  const termsVersion = /^[0-9A-Za-z._-]{1,32}$/.test(termsVersionRaw) ? termsVersionRaw : "unspecified";
  return {
    ok: true,
    value: { name, email, websiteUrl: websiteUrl!, promotionPlan, termsVersion },
  };
}

export type SubmitApplicationResult =
  | { kind: "created"; id: string }
  | { kind: "duplicate_pending"; id: string }
  | { kind: "over_capacity" };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function submitAffiliateApplication(
  prisma: PrismaClient,
  input: AffiliateApplicationInput,
  opts: { now?: Date; maxPerHour?: number } = {}
): Promise<SubmitApplicationResult> {
  const now = opts.now ?? new Date();
  const emailNormalized = normalizeEmailForSelfReferralCheck(input.email);

  const existing = await prisma.affiliateApplication.findUnique({
    where: { pending_email_key: emailNormalized },
    select: { id: true },
  });
  if (existing) return { kind: "duplicate_pending", id: existing.id };

  const maxPerHour = opts.maxPerHour ?? applicationsMaxPerHour();
  const recent = await prisma.affiliateApplication.count({
    where: { created_at: { gte: new Date(now.getTime() - 60 * 60_000) } },
  });
  if (recent >= maxPerHour) return { kind: "over_capacity" };

  try {
    const created = await prisma.affiliateApplication.create({
      data: {
        name: input.name,
        email: input.email,
        email_normalized: emailNormalized,
        pending_email_key: emailNormalized,
        website_url: input.websiteUrl,
        promotion_plan: input.promotionPlan,
        terms_version: input.termsVersion,
        terms_accepted_at: now,
        status: "pending",
      },
      select: { id: true },
    });
    return { kind: "created", id: created.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Concurrent duplicate submit for the same email: dedupe onto the winner.
    const winner = await prisma.affiliateApplication.findUnique({
      where: { pending_email_key: emailNormalized },
      select: { id: true },
    });
    if (winner) return { kind: "duplicate_pending", id: winner.id };
    throw err;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseApplicationNotifyEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.AFFILIATE_APPLICATION_NOTIFY_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter((email) => isPlausibleEmail(email.toLowerCase()));
}

/**
 * Optional founder notification for a NEW application. Never emails the applicant.
 * No-op unless AFFILIATE_APPLICATION_NOTIFY_EMAILS is set and transactional email is configured.
 * Never throws.
 */
export async function notifyFounderOfApplication(
  input: AffiliateApplicationInput,
  logger?: { warn: (obj: unknown, msg: string) => void }
): Promise<"sent" | "skipped" | "failed"> {
  const to = parseApplicationNotifyEmails();
  if (to.length === 0 || !isTransactionalEmailConfigured()) return "skipped";
  try {
    const origin = dashboardOriginOrNull();
    const adminUrl = origin ? `${origin}/dashboard/settings/affiliates` : null;
    const html = [
      `<p>New affiliate program application.</p>`,
      `<p><strong>Name:</strong> ${escapeHtml(input.name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(input.email)}</p>`,
      `<p><strong>Website / profile:</strong> ${escapeHtml(input.websiteUrl)}</p>`,
      `<p><strong>How they will promote:</strong></p><p>${escapeHtml(input.promotionPlan).replace(/\n/g, "<br />")}</p>`,
      adminUrl ? `<p><a href="${escapeHtml(adminUrl)}">Review in the founder admin</a></p>` : "",
    ].join("");
    const result = await sendTransactionalEmail({
      to,
      subject: `Affiliate application from ${input.name.replace(/[\r\n\0]/g, "").slice(0, 80)}`,
      html,
    });
    return result.sent ? "sent" : "failed";
  } catch (err) {
    logger?.warn({ err }, "Affiliate application founder notification failed");
    return "failed";
  }
}

export function parseApplicationStatusFilter(raw: unknown): AffiliateApplicationStatus | "all" | null {
  if (raw === undefined || raw === null || raw === "") return "pending";
  if (raw === "all") return "all";
  if (typeof raw === "string" && (AFFILIATE_APPLICATION_STATUSES as readonly string[]).includes(raw)) {
    return raw as AffiliateApplicationStatus;
  }
  return null;
}

export const APPLICATION_LIST_LIMIT = 200;

export async function listAffiliateApplicationsForAdmin(
  prisma: PrismaClient,
  status: AffiliateApplicationStatus | "all"
) {
  const rows = await prisma.affiliateApplication.findMany({
    where: status === "all" ? {} : { status },
    orderBy: { created_at: "desc" },
    take: APPLICATION_LIST_LIMIT,
    include: { affiliate: { select: { id: true, code: true, state: true } } },
  });

  const reviewerIds = [...new Set(rows.map((r) => r.reviewed_by).filter((id): id is string => !!id))];
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, email: true } })
    : [];
  const reviewerEmail = new Map(reviewers.map((u) => [u.id, u.email]));

  const normalizedEmails = [...new Set(rows.map((r) => r.email_normalized))];
  const existingAffiliates = normalizedEmails.length
    ? await prisma.affiliate.findMany({
        where: { email_normalized: { in: normalizedEmails } },
        select: { id: true, code: true, email_normalized: true },
      })
    : [];
  const affiliateByEmail = new Map(existingAffiliates.map((a) => [a.email_normalized, a]));

  const out = [];
  for (const row of rows) {
    const existing = affiliateByEmail.get(row.email_normalized);
    out.push({
      id: row.id,
      name: row.name,
      email: row.email,
      websiteUrl: row.website_url,
      promotionPlan: row.promotion_plan,
      termsVersion: row.terms_version,
      termsAcceptedAt: row.terms_accepted_at.toISOString(),
      status: row.status,
      reviewNote: row.review_note,
      reviewedBy: row.reviewed_by,
      reviewedByEmail: row.reviewed_by ? reviewerEmail.get(row.reviewed_by) ?? null : null,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      affiliateId: row.affiliate_id,
      affiliateCode: row.affiliate?.code ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      existingAffiliate:
        existing && existing.id !== row.affiliate_id ? { id: existing.id, code: existing.code } : null,
      suggestedCode:
        row.status === "pending" ? await suggestUniqueAffiliateCode(prisma, row.name) : null,
    });
  }
  return out;
}

function cleanNote(raw: unknown): string | null {
  const note = cleanMultiline(raw).slice(0, APPLICATION_REVIEW_NOTE_MAX);
  return note.length > 0 ? note : null;
}

export type ApproveApplicationResult =
  | { kind: "approved"; applicationId: string; affiliateId: string; code: string }
  | { kind: "not_found" }
  | {
      kind: "refused";
      code: "not_pending" | "invalid_code" | "code_taken" | "invalid_name";
      message: string;
    };

class ApprovalRefused extends Error {
  constructor(readonly result: Extract<ApproveApplicationResult, { kind: "refused" }>) {
    super(result.message);
  }
}

/**
 * Approve a pending application: create the Affiliate (name + email from the application,
 * founder-chosen code) and link it, atomically. Refuses non-pending applications.
 */
export async function approveAffiliateApplication(
  prisma: PrismaClient,
  input: { applicationId: string; actorUserId: string; code: string; note?: unknown },
  now: Date = new Date()
): Promise<ApproveApplicationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "AffiliateApplication" WHERE id = ${input.applicationId} FOR UPDATE`
      );
      if (locked.length === 0) return { kind: "not_found" as const };
      const application = await tx.affiliateApplication.findUnique({
        where: { id: input.applicationId },
      });
      if (!application) return { kind: "not_found" as const };
      if (application.status !== "pending") {
        throw new ApprovalRefused({
          kind: "refused",
          code: "not_pending",
          message: `Application is already ${application.status}`,
        });
      }
      if (!input.code.trim()) {
        throw new ApprovalRefused({
          kind: "refused",
          code: "invalid_code",
          message: "Choose a referral code",
        });
      }

      const created = await createAffiliate(tx, {
        name: application.name,
        email: application.email,
        code: input.code,
      });
      if (created.kind === "refused") {
        throw new ApprovalRefused({ kind: "refused", code: created.code, message: created.message });
      }

      await tx.affiliateApplication.update({
        where: { id: application.id },
        data: {
          status: "approved",
          pending_email_key: null,
          reviewed_by: input.actorUserId,
          reviewed_at: now,
          review_note: cleanNote(input.note),
          affiliate_id: created.id,
        },
      });
      return {
        kind: "approved" as const,
        applicationId: application.id,
        affiliateId: created.id,
        code: created.code,
      };
    });
  } catch (err) {
    if (err instanceof ApprovalRefused) return err.result;
    if (isUniqueViolation(err)) {
      return { kind: "refused", code: "code_taken", message: "Affiliate code is already in use" };
    }
    throw err;
  }
}

export type RejectApplicationResult =
  | { kind: "rejected"; applicationId: string }
  | { kind: "not_found" }
  | { kind: "refused"; code: "not_pending"; message: string };

export async function rejectAffiliateApplication(
  prisma: PrismaClient,
  input: { applicationId: string; actorUserId: string; note?: unknown },
  now: Date = new Date()
): Promise<RejectApplicationResult> {
  const updated = await prisma.affiliateApplication.updateMany({
    where: { id: input.applicationId, status: "pending" },
    data: {
      status: "rejected",
      pending_email_key: null,
      reviewed_by: input.actorUserId,
      reviewed_at: now,
      review_note: cleanNote(input.note),
    },
  });
  if (updated.count === 1) return { kind: "rejected", applicationId: input.applicationId };
  const existing = await prisma.affiliateApplication.findUnique({
    where: { id: input.applicationId },
    select: { status: true },
  });
  if (!existing) return { kind: "not_found" };
  return { kind: "refused", code: "not_pending", message: `Application is already ${existing.status}` };
}
