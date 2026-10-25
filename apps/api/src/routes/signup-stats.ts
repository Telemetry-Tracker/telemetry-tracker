import { createHash, timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";

const DAY = 86_400_000;
type Row = {
  day: string; source: string | null; medium: string | null;
  campaign: string | null; referrer: string | null;
  signups: bigint; affiliates: bigint;
};

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.toISOString().slice(0, 10) === value ? date : null;
}
const hash = (value: string) => createHash("sha256").update(value).digest();

/** Only operator-approved acquisition labels may leave the API: tags are untrusted input. */
function labels(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((s) => s.trim()).filter((value) => value !== "" && value !== "unattributed" && value !== "redacted"));
}
function label(value: string | null, approved: Set<string>): string {
  return value === null ? "unattributed" : approved.has(value) ? value : "redacted";
}

export async function signupStatsRoutes(app: FastifyInstance) {
  const token = process.env.SIGNUP_STATS_TOKEN;
  const approved = {
    source: labels(process.env.SIGNUP_STATS_SOURCES),
    medium: labels(process.env.SIGNUP_STATS_MEDIUMS),
    campaign: labels(process.env.SIGNUP_STATS_CAMPAIGNS),
    referrer: labels(process.env.SIGNUP_STATS_REFERRERS),
  };
  await app.register(rateLimit, { global: false, max: 30, timeWindow: "1 minute" });
  app.get("/api/signup-stats", {
    onRequest: [app.rateLimit(), async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!token) return reply.code(404).send({ error: "Not found" });
      const authorization = request.headers.authorization ?? "";
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      const valid = timingSafeEqual(hash(match?.[1] ?? ""), hash(token));
      if (!match || !valid) return reply.code(401).send({ error: "Unauthorized" });
    }],
  }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = query.end === undefined ? today : parseDate(query.end);
    const start = query.start === undefined && end ? new Date(end.getTime() - 29 * DAY) : parseDate(query.start);
    if (Object.keys(query).some((key) => key !== "start" && key !== "end") ||
        !start || !end || start.getUTCFullYear() < 1 || start > end || (end.getTime() - start.getTime()) / DAY >= 366) {
      return reply.code(400).send({ error: "Use start/end YYYY-MM-DD with an inclusive range of 1–366 days" });
    }
    const exclusiveEnd = new Date(end.getTime() + DAY);
    // Prisma DateTime columns are timestamp without time zone containing UTC values.
    // Aggregate in Postgres; never fetch personal columns or individual referral records.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT to_char(u.created_at, 'YYYY-MM-DD') AS day,
             u.utm_source AS source, u.utm_medium AS medium,
             u.utm_campaign AS campaign, u.referrer_host AS referrer,
             count(*) AS signups,
             count(*) FILTER (WHERE r.status = 'ACTIVE' AND r.affiliate_id IS NOT NULL) AS affiliates
      FROM "User" u LEFT JOIN "UserReferral" r ON r.user_id = u.id
      WHERE u.created_at >= ${start.toISOString()}::timestamp AND u.created_at < ${exclusiveEnd.toISOString()}::timestamp
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5
    `;
    const daily = new Map<string, { date: string; signups: number; affiliateSignups: number }>();
    for (let time = start.getTime(); time < exclusiveEnd.getTime(); time += DAY) {
      const date = new Date(time).toISOString().slice(0, 10);
      daily.set(date, { date, signups: 0, affiliateSignups: 0 });
    }
    const breakdown = new Map<string, { source: string; medium: string; campaign: string; referrer: string; signups: number; affiliateSignups: number }>();
    for (const row of rows) {
      const signups = Number(row.signups);
      const affiliateSignups = Number(row.affiliates);
      const day = daily.get(row.day)!;
      day.signups += signups;
      day.affiliateSignups += affiliateSignups;
      const dimensions = {
        source: label(row.source, approved.source), medium: label(row.medium, approved.medium),
        campaign: label(row.campaign, approved.campaign), referrer: label(row.referrer, approved.referrer),
      };
      const key = JSON.stringify(dimensions);
      const group = breakdown.get(key) ?? { ...dimensions, signups: 0, affiliateSignups: 0 };
      group.signups += signups;
      group.affiliateSignups += affiliateSignups;
      breakdown.set(key, group);
    }
    const weekly = new Map<string, { weekStart: string; signups: number; affiliateSignups: number }>();
    for (const day of daily.values()) {
      const date = new Date(`${day.date}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      const weekStart = date.toISOString().slice(0, 10);
      const week = weekly.get(weekStart) ?? { weekStart, signups: 0, affiliateSignups: 0 };
      week.signups += day.signups;
      week.affiliateSignups += day.affiliateSignups;
      weekly.set(weekStart, week);
    }
    const days = [...daily.values()];
    return {
      range: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), timezone: "UTC" },
      signups: days.reduce((sum, day) => sum + day.signups, 0),
      affiliateSignups: days.reduce((sum, day) => sum + day.affiliateSignups, 0),
      daily: days, weekly: [...weekly.values()],
      acquisition: [...breakdown.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      conversions: null,
      conversionNote: "Current organization plans/subscriptions do not establish historical free-to-paid transitions or unique signup-cohort ownership; conversion counts cannot be reliably derived.",
    };
  });
}
