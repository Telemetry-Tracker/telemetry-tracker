import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signupStatsRoutes } from "./signup-stats.js";
import { prisma } from "../lib/db.js";
vi.mock("../lib/db.js", () => ({ prisma: { $queryRaw: vi.fn() } }));
const apps: ReturnType<typeof Fastify>[] = [];
beforeEach(() => {
  vi.stubEnv("SIGNUP_STATS_TOKEN", "test-secret");
  vi.stubEnv("SIGNUP_STATS_SOURCES", "newsletter");
  vi.stubEnv("SIGNUP_STATS_MEDIUMS", "email");
  vi.stubEnv("SIGNUP_STATS_CAMPAIGNS", "launch");
  vi.stubEnv("SIGNUP_STATS_REFERRERS", "search.example");
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); vi.unstubAllEnvs(); });
async function app() {
  const instance = Fastify(); apps.push(instance);
  await instance.register(signupStatsRoutes);
  return instance;
}
const headers = { authorization: "Bearer test-secret" };
const url = "/api/signup-stats?start=2026-10-04&end=2026-10-06";
describe("signup stats", () => {
  for (const authorization of [undefined, "Bearer wrong", "Bearer test-secret-extra", "Basic test-secret", "Bearer test-secret "]) {
    it(`rejects ${authorization ?? "missing token"} without querying`, async () => {
      const response = await (await app()).inject({ url, headers: authorization ? { authorization } : {} });
      expect(response.statusCode).toBe(401);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  }
  it("is disabled without its dedicated token, even with session/API credentials", async () => {
    vi.stubEnv("SIGNUP_STATS_TOKEN", "");
    const response = await (await app()).inject({ url, headers: { ...headers, cookie: "session=secret", "x-api-key": "secret" } });
    expect(response.statusCode).toBe(404);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  for (const query of ["start=2026-02-30", "start=0000-01-01", "start=garbage", "start=2026-10-07&end=2026-10-06", "start=2025-01-01&end=2026-01-02", "start=2026-10-01T00:00:00Z", "start=2026-10-01&start=2026-10-02", "unknown=true", "end="]) {
    it(`rejects invalid range ${query}`, async () => {
      const response = await (await app()).inject({ url: `/api/signup-stats?${query}`, headers });
      expect(response.statusCode).toBe(400);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  }
  it("accepts exactly 366 inclusive days and parameterizes exclusive bounds", async () => {
    const response = await (await app()).inject({ url: "/api/signup-stats?start=2024-01-01&end=2024-12-31", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().daily).toHaveLength(366);
    const args = vi.mocked(prisma.$queryRaw).mock.calls[0];
    expect(args.slice(1)).toEqual(["2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"]);
  });
  it("defaults to 30 UTC days including today", async () => {
    const response = await (await app()).inject({ url: "/api/signup-stats", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().daily).toHaveLength(30);
    expect(response.json().range.end).toBe(new Date().toISOString().slice(0, 10));
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("aggregates daily, Monday weeks, attribution and affiliates without personal data", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { day: "2026-10-04", source: null, medium: null, campaign: null, referrer: null, signups: 3n, affiliates: 1n },
      { day: "2026-10-05", source: "newsletter", medium: "email", campaign: "launch", referrer: "search.example", signups: 2n, affiliates: 1n },
      { day: "2026-10-06", source: "newsletter", medium: "email", campaign: "launch", referrer: "search.example", signups: 4n, affiliates: 0n },
      { day: "2026-10-06", source: "Alice Smith", medium: "alice@example.com", campaign: "192.0.2.1", referrer: "alice.example", signups: 1n, affiliates: 0n },
      { day: "2026-10-06", source: "Bob Jones", medium: "bob@example.com", campaign: "198.51.100.1", referrer: "bob.example", signups: 1n, affiliates: 0n },
    ]);
    const response = await (await app()).inject({ url, headers });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.signups).toBe(11);
    expect(body.affiliateSignups).toBe(2);
    expect(body.daily.map((day: { signups: number }) => day.signups)).toEqual([3, 2, 6]);
    expect(body.weekly).toEqual([
      { weekStart: "2026-09-28", signups: 3, affiliateSignups: 1 },
      { weekStart: "2026-10-05", signups: 8, affiliateSignups: 1 },
    ]);
    expect(body.acquisition).toEqual(expect.arrayContaining([
      { source: "unattributed", medium: "unattributed", campaign: "unattributed", referrer: "unattributed", signups: 3, affiliateSignups: 1 },
      { source: "newsletter", medium: "email", campaign: "launch", referrer: "search.example", signups: 6, affiliateSignups: 1 },
      { source: "redacted", medium: "redacted", campaign: "redacted", referrer: "redacted", signups: 2, affiliateSignups: 0 },
    ]));
    expect(body.conversions).toBeNull();
    for (const privateValue of ["Alice", "Bob", "@example.com", "192.0.2.1", "198.51.100.1", "alice.example", "bob.example", "user_id", "affiliate_id", "password_hash"]) {
      expect(response.body).not.toContain(privateValue);
    }
    const sql = (vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as string[]).join("?");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("r.status = 'ACTIVE' AND r.affiliate_id IS NOT NULL");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|email|display_name|password_hash/);
  });
  it("fills empty days and groups ISO year boundaries by Monday UTC", async () => {
    const response = await (await app()).inject({ url: "/api/signup-stats?start=2025-12-31&end=2026-01-01", headers });
    expect(response.json().weekly).toEqual([{ weekStart: "2025-12-29", signups: 0, affiliateSignups: 0 }]);
    expect(response.json().acquisition).toEqual([]);
  });
  it("rate limits failed authentication attempts too", async () => {
    const instance = await app();
    for (let i = 0; i < 30; i++) expect((await instance.inject({ url })).statusCode).toBe(401);
    expect((await instance.inject({ url, headers })).statusCode).toBe(429);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
