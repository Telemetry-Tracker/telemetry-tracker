/**
 * Public affiliate applications + founder review (approve / reject) integration tests.
 * Run with: RUN_DB_INTEGRATION_TESTS=true pnpm test affiliate-applications
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.js";
import { prisma } from "../lib/db.js";
import {
  applyAffiliateTestEnv,
  cleanupAffiliateFixtures,
  restoreEnv,
  snapshotEnv,
} from "./affiliate-test-helpers.js";
import { CLIENT_IP_FORWARD_HEADER } from "../lib/affiliate-application.js";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const testSuite = shouldRun ? describe : describe.skip;

const mockCustomersCreate = vi.fn(async () => ({ id: `cus_app_${Date.now()}`, metadata: {} }));

vi.mock("stripe", () => {
  const mockStripe = vi.fn().mockImplementation(() => ({
    customers: {
      create: (...args: unknown[]) => (mockCustomersCreate as (...a: unknown[]) => unknown)(...args),
      retrieve: vi.fn(async (id: string) => ({ id, deleted: false, metadata: {} })),
      update: vi.fn(async (id: string) => ({ id })),
    },
    webhooks: {
      constructEvent: (payload: Buffer | string) =>
        JSON.parse(typeof payload === "string" ? payload : payload.toString()),
    },
  }));
  return { default: mockStripe };
});

const ENV_KEYS = [
  "AFFILIATES_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_BUSINESS",
  "TELEMETRY_DASHBOARD_ORIGIN",
  "TELEMETRY_ALLOW_REGISTRATION",
  "AFFILIATE_ADMIN_EMAILS",
  "RATE_LIMIT_AFFILIATE_APPLICATION_MAX",
  "AFFILIATE_APPLICATIONS_MAX_PER_HOUR",
  "AFFILIATE_APPLICATION_NOTIFY_EMAILS",
] as const;

const DOMAIN = "apply-it.example.com";
/** Exact domain match on this file's throwaway applicant emails. */
const isOwnEmail = (email: string) => email.slice(email.lastIndexOf("@") + 1) === DOMAIN;

testSuite("Affiliate applications (public form + founder review)", () => {
  let app: FastifyInstance;
  let originalEnv: Record<string, string | undefined> = {};
  const userIds: string[] = [];
  const affiliateIds: string[] = [];
  let run = 0;

  function uniqueEmail(prefix: string) {
    run += 1;
    return `${prefix}-${Date.now()}-${run}@${DOMAIN}`;
  }

  function applicationPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: "Grace Hopper",
      email: uniqueEmail("grace"),
      websiteUrl: "https://grace.dev",
      promotionPlan: "I write a weekly newsletter for backend engineers and maintain two OSS libs.",
      acceptTerms: true,
      termsVersion: "2026-10-06",
      ...overrides,
    };
  }

  async function apply(payload: Record<string, unknown>, ip?: string, target = app) {
    return target.inject({
      method: "POST",
      url: "/api/affiliate-applications",
      headers: ip ? { [CLIENT_IP_FORWARD_HEADER]: ip } : {},
      payload,
    });
  }

  async function registerUser(email: string, extra: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "Password123!", displayName: "Test", ...extra },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { user: { id: string }; sessionId: string };
    userIds.push(body.user.id);
    return body;
  }

  async function founderSession() {
    const email = uniqueEmail("founder");
    process.env.AFFILIATE_ADMIN_EMAILS = email;
    const { sessionId } = await registerUser(email);
    return { cookie: `telemetry_session=${sessionId}` };
  }

  async function cleanupApplications() {
    const apps = await prisma.affiliateApplication.findMany({
      where: { email: { endsWith: `@${DOMAIN}` } },
      select: { affiliate_id: true },
    });
    affiliateIds.push(...apps.map((a) => a.affiliate_id).filter((id): id is string => !!id));
    await prisma.affiliateApplication.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  }

  beforeAll(async () => {
    originalEnv = snapshotEnv(ENV_KEYS);
    applyAffiliateTestEnv({
      RATE_LIMIT_AFFILIATE_APPLICATION_MAX: "1000",
      AFFILIATE_APPLICATIONS_MAX_PER_HOUR: "1000",
    });
    delete process.env.AFFILIATE_APPLICATION_NOTIFY_EMAILS;
    app = await createApp();
    await app.ready();
  });

  beforeEach(async () => {
    process.env.AFFILIATES_ENABLED = "true";
    process.env.AFFILIATE_APPLICATIONS_MAX_PER_HOUR = "1000";
    await cleanupApplications();
  });

  afterAll(async () => {
    await cleanupApplications();
    await cleanupAffiliateFixtures(prisma, { userIds, orgIds: [], affiliateIds });
    await app.close();
    restoreEnv(originalEnv);
  });

  describe("public submission", () => {
    it("returns 404 when the affiliate flag is off", async () => {
      process.env.AFFILIATES_ENABLED = "false";
      const response = await apply(applicationPayload());
      expect(response.statusCode).toBe(404);
      expect(await prisma.affiliateApplication.count({ where: { email: { endsWith: `@${DOMAIN}` } } })).toBe(0);
    });

    it("stores a pending application with terms acceptance and no review fields", async () => {
      const payload = applicationPayload({ email: "Ada.Lovelace+tt@" + DOMAIN, websiteUrl: "ada.dev/blog" });
      const response = await apply(payload);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ ok: true });
      const row = await prisma.affiliateApplication.findFirst({
        where: { email: `ada.lovelace+tt@${DOMAIN}` },
      });
      expect(row).toMatchObject({
        name: "Grace Hopper",
        email_normalized: `ada.lovelace@${DOMAIN}`,
        pending_email_key: `ada.lovelace@${DOMAIN}`,
        website_url: "https://ada.dev/blog",
        status: "pending",
        terms_version: "2026-10-06",
        reviewed_by: null,
        reviewed_at: null,
        affiliate_id: null,
      });
      expect(row?.terms_accepted_at).toBeInstanceOf(Date);
    });

    it("validates server-side and returns field errors", async () => {
      const response = await apply({
        name: "x",
        email: "nope",
        websiteUrl: "javascript:alert(1)",
        promotionPlan: "short",
        acceptTerms: false,
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { fields: Record<string, string> };
      expect(Object.keys(body.fields).sort()).toEqual(
        ["acceptTerms", "email", "name", "promotionPlan", "websiteUrl"].sort()
      );
      const tooLong = await apply(applicationPayload({ promotionPlan: "x".repeat(1001) }));
      expect(tooLong.statusCode).toBe(400);
    });

    it("silently drops honeypot submissions", async () => {
      const payload = applicationPayload({ company_website: "https://spam.example" });
      const response = await apply(payload);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ ok: true });
      expect(await prisma.affiliateApplication.count({ where: { email: String(payload.email) } })).toBe(0);
    });

    it("dedupes repeat pending applications by normalized email, but allows reapplying after review", async () => {
      const first = await apply(applicationPayload({ email: `dedupe.me@gmail.com` }));
      expect(first.statusCode).toBe(200);
      // Same gmail inbox (dots / +tag) → no second pending row, same success response.
      const second = await apply(applicationPayload({ email: `de.dupeme+again@gmail.com`, name: "Other" }));
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body));
      const rows = await prisma.affiliateApplication.findMany({
        where: { email_normalized: "dedupeme@gmail.com" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("Grace Hopper");

      await prisma.affiliateApplication.update({
        where: { id: rows[0]!.id },
        data: { status: "rejected", pending_email_key: null },
      });
      const third = await apply(applicationPayload({ email: `dedupe.me@gmail.com` }));
      expect(third.statusCode).toBe(200);
      expect(
        await prisma.affiliateApplication.count({ where: { email_normalized: "dedupeme@gmail.com" } })
      ).toBe(2);
      await prisma.affiliateApplication.deleteMany({ where: { email_normalized: "dedupeme@gmail.com" } });
    });

    it("dedupes concurrent duplicate submissions to one row", async () => {
      const email = uniqueEmail("race");
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => apply(applicationPayload({ email })))
      );
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      expect(await prisma.affiliateApplication.count({ where: { email } })).toBe(1);
    });

    it("enforces the global hourly cap", async () => {
      // Cap counts every application in the last hour; allow 2 more than whatever the DB already has.
      const existing = await prisma.affiliateApplication.count({
        where: { created_at: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      process.env.AFFILIATE_APPLICATIONS_MAX_PER_HOUR = String(existing + 2);
      expect((await apply(applicationPayload())).statusCode).toBe(200);
      expect((await apply(applicationPayload())).statusCode).toBe(200);
      const capped = await apply(applicationPayload());
      expect(capped.statusCode).toBe(429);
      expect(await prisma.affiliateApplication.count({ where: { email: { endsWith: `@${DOMAIN}` } } })).toBe(2);
    });

    it("rate limits per forwarded visitor IP", async () => {
      process.env.RATE_LIMIT_AFFILIATE_APPLICATION_MAX = "2";
      const limited = await createApp();
      await limited.ready();
      process.env.RATE_LIMIT_AFFILIATE_APPLICATION_MAX = "1000";
      try {
        expect((await apply(applicationPayload(), "203.0.113.9", limited)).statusCode).toBe(200);
        expect((await apply(applicationPayload(), "203.0.113.9", limited)).statusCode).toBe(200);
        const blocked = await apply(applicationPayload(), "203.0.113.9", limited);
        expect(blocked.statusCode).toBe(429);
        // A different visitor is unaffected.
        expect((await apply(applicationPayload(), "198.51.100.4", limited)).statusCode).toBe(200);
        expect(await prisma.affiliateApplication.count({ where: { email: { endsWith: `@${DOMAIN}` } } })).toBe(3);
      } finally {
        await limited.close();
      }
    });
  });

  describe("founder admin", () => {
    it("gates access: 404 flag off, 401 no session, 403 not allowlisted, 200 founder", async () => {
      const founder = await founderSession();
      const stranger = await registerUser(uniqueEmail("stranger"));
      for (const url of ["/api/meta/affiliates/access", "/api/meta/affiliates/applications"]) {
        expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
        expect(
          (await app.inject({ method: "GET", url, headers: { cookie: `telemetry_session=${stranger.sessionId}` } }))
            .statusCode
        ).toBe(403);
        expect((await app.inject({ method: "GET", url, headers: founder })).statusCode).toBe(200);
      }
      const approveUrl = "/api/meta/affiliates/applications/00000000-0000-4000-8000-000000000000/approve";
      expect(
        (
          await app.inject({
            method: "POST",
            url: approveUrl,
            headers: { cookie: `telemetry_session=${stranger.sessionId}` },
            payload: { code: "x1" },
          })
        ).statusCode
      ).toBe(403);
      process.env.AFFILIATES_ENABLED = "false";
      expect(
        (await app.inject({ method: "GET", url: "/api/meta/affiliates/access", headers: founder })).statusCode
      ).toBe(404);
    });

    it("lists and filters applications with a suggested unique code", async () => {
      const founder = await founderSession();
      const takenCode = `grace-hopper`;
      const existing = await prisma.affiliate.findUnique({ where: { code: takenCode } });
      if (!existing) {
        const created = await prisma.affiliate.create({
          data: { code: takenCode, name: "Taken", email: null, state: "active" },
        });
        affiliateIds.push(created.id);
      }
      await apply(applicationPayload());
      const rejectedEmail = uniqueEmail("rej");
      await apply(applicationPayload({ email: rejectedEmail }));
      await prisma.affiliateApplication.updateMany({
        where: { email: rejectedEmail },
        data: { status: "rejected", pending_email_key: null },
      });

      const pending = await app.inject({
        method: "GET",
        url: "/api/meta/affiliates/applications",
        headers: founder,
      });
      const pendingBody = JSON.parse(pending.body) as {
        status: string;
        applications: { email: string; status: string; suggestedCode: string | null }[];
      };
      expect(pendingBody.status).toBe("pending");
      const mine = pendingBody.applications.filter((a) => isOwnEmail(a.email));
      expect(mine).toHaveLength(1);
      expect(mine[0]?.suggestedCode).toMatch(/^grace-hopper-[0-9a-f]{4}$/);

      const rejected = await app.inject({
        method: "GET",
        url: "/api/meta/affiliates/applications?status=rejected",
        headers: founder,
      });
      const rejectedBody = JSON.parse(rejected.body) as { applications: { email: string; suggestedCode: null }[] };
      expect(rejectedBody.applications.filter((a) => isOwnEmail(a.email)).map((a) => a.email)).toEqual([
        rejectedEmail,
      ]);
      expect(rejectedBody.applications[0]?.suggestedCode).toBeNull();

      const all = await app.inject({
        method: "GET",
        url: "/api/meta/affiliates/applications?status=all",
        headers: founder,
      });
      expect(
        (JSON.parse(all.body) as { applications: { email: string }[] }).applications.filter((a) =>
          isOwnEmail(a.email)
        )
      ).toHaveLength(2);

      const bad = await app.inject({
        method: "GET",
        url: "/api/meta/affiliates/applications?status=nope",
        headers: founder,
      });
      expect(bad.statusCode).toBe(400);
    });

    it("approves: creates the affiliate with the chosen code, links it, and the code then attributes signups", async () => {
      const founder = await founderSession();
      const email = uniqueEmail("approve");
      await apply(applicationPayload({ email, name: "Linus T" }));
      const application = await prisma.affiliateApplication.findFirstOrThrow({ where: { email } });

      const invalid = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/approve`,
        headers: founder,
        payload: { code: "bad code!" },
      });
      expect(invalid.statusCode).toBe(400);
      expect(JSON.parse(invalid.body).code).toBe("invalid_code");

      const code = `Linus-${Date.now()}`;
      const approved = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/approve`,
        headers: founder,
        payload: { code, note: "Great newsletter" },
      });
      expect(approved.statusCode).toBe(201);
      const body = JSON.parse(approved.body) as { affiliateId: string; code: string };
      affiliateIds.push(body.affiliateId);
      expect(body.code).toBe(code.toLowerCase());

      const affiliate = await prisma.affiliate.findUniqueOrThrow({ where: { id: body.affiliateId } });
      expect(affiliate).toMatchObject({
        name: "Linus T",
        email,
        email_normalized: email,
        state: "active",
        commission_rate_bps: 3000,
      });
      const reviewed = await prisma.affiliateApplication.findUniqueOrThrow({ where: { id: application.id } });
      expect(reviewed).toMatchObject({
        status: "approved",
        pending_email_key: null,
        affiliate_id: body.affiliateId,
        review_note: "Great newsletter",
      });
      expect(reviewed.reviewed_by).toBeTruthy();
      expect(reviewed.reviewed_at).toBeInstanceOf(Date);

      // Approving twice is refused; nothing else is created.
      const again = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/approve`,
        headers: founder,
        payload: { code: `${code}-2` },
      });
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.body).code).toBe("not_pending");

      // The new code attributes a referred signup (existing capture rules).
      const referred = await registerUser(uniqueEmail("referred"), { referralCode: code.toUpperCase() });
      const referral = await prisma.userReferral.findUnique({ where: { user_id: referred.user.id } });
      expect(referral).toMatchObject({ affiliate_id: body.affiliateId, status: "ACTIVE" });

      // Self-referral protection uses the application email.
      const self = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "Password123!", displayName: "Self", referralCode: code },
      });
      expect(self.statusCode).toBe(201);
      const selfUser = JSON.parse(self.body) as { user: { id: string } };
      userIds.push(selfUser.user.id);
      const selfReferral = await prisma.userReferral.findUnique({ where: { user_id: selfUser.user.id } });
      expect(selfReferral?.status ?? "none").not.toBe("ACTIVE");

      const listed = await app.inject({
        method: "GET",
        url: "/api/meta/affiliates/applications?status=approved",
        headers: founder,
      });
      const row = (JSON.parse(listed.body) as {
        applications: { id: string; affiliateCode: string; reviewedByEmail: string }[];
      }).applications.find((a) => a.id === application.id);
      expect(row?.affiliateCode).toBe(code.toLowerCase());
      expect(row?.reviewedByEmail).toMatch(/^founder-/);
    });

    it("refuses an approval code that is already taken (409) and keeps the application pending", async () => {
      const founder = await founderSession();
      const taken = await prisma.affiliate.create({
        data: { code: `taken-${Date.now()}`, name: "Taken", email: null, state: "active" },
      });
      affiliateIds.push(taken.id);
      const email = uniqueEmail("taken");
      await apply(applicationPayload({ email }));
      const application = await prisma.affiliateApplication.findFirstOrThrow({ where: { email } });
      const response = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/approve`,
        headers: founder,
        payload: { code: taken.code.toUpperCase() },
      });
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).code).toBe("code_taken");
      const after = await prisma.affiliateApplication.findUniqueOrThrow({ where: { id: application.id } });
      expect(after.status).toBe("pending");
      expect(after.affiliate_id).toBeNull();
      expect(await prisma.affiliate.count({ where: { email } })).toBe(0);
    });

    it("rejects a pending application and refuses approving it afterwards", async () => {
      const founder = await founderSession();
      const email = uniqueEmail("reject");
      await apply(applicationPayload({ email }));
      const application = await prisma.affiliateApplication.findFirstOrThrow({ where: { email } });
      const rejected = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/reject`,
        headers: founder,
        payload: { note: "Coupon site" },
      });
      expect(rejected.statusCode).toBe(200);
      const row = await prisma.affiliateApplication.findUniqueOrThrow({ where: { id: application.id } });
      expect(row).toMatchObject({ status: "rejected", pending_email_key: null, review_note: "Coupon site" });
      expect(row.reviewed_by).toBeTruthy();

      const rejectAgain = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/reject`,
        headers: founder,
        payload: {},
      });
      expect(rejectAgain.statusCode).toBe(409);
      const approve = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/${application.id}/approve`,
        headers: founder,
        payload: { code: `late-${Date.now()}` },
      });
      expect(approve.statusCode).toBe(409);
      const missing = await app.inject({
        method: "POST",
        url: `/api/meta/affiliates/applications/00000000-0000-4000-8000-000000000000/reject`,
        headers: founder,
        payload: {},
      });
      expect(missing.statusCode).toBe(404);
    });

    it("creates a test affiliate directly and disables / re-enables it (used for the production attribution check)", async () => {
      const founder = await founderSession();
      const code = `prodcheck-${Date.now()}`;
      const created = await app.inject({
        method: "POST",
        url: "/api/meta/affiliates",
        headers: founder,
        payload: { name: "Prod check", email: uniqueEmail("prodcheck"), code },
      });
      expect(created.statusCode).toBe(201);
      const { id } = JSON.parse(created.body) as { id: string };
      affiliateIds.push(id);

      const disabled = await app.inject({
        method: "PATCH",
        url: `/api/meta/affiliates/${id}`,
        headers: founder,
        payload: { state: "disabled" },
      });
      expect(disabled.statusCode).toBe(200);
      const list = await app.inject({ method: "GET", url: "/api/meta/affiliates", headers: founder });
      const row = (JSON.parse(list.body) as { affiliates: { id: string; state: string }[] }).affiliates.find(
        (a) => a.id === id
      );
      expect(row?.state).toBe("disabled");
      // Disabled codes no longer attribute new signups.
      const visitor = await registerUser(uniqueEmail("visitor"), { referralCode: code });
      expect(await prisma.userReferral.findUnique({ where: { user_id: visitor.user.id } })).toBeNull();

      const enabled = await app.inject({
        method: "PATCH",
        url: `/api/meta/affiliates/${id}`,
        headers: founder,
        payload: { state: "active" },
      });
      expect(enabled.statusCode).toBe(200);
      expect((await prisma.affiliate.findUniqueOrThrow({ where: { id } })).state).toBe("active");
    });
  });
});
