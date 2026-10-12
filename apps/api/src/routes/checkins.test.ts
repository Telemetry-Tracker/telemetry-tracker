import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), heartbeat: vi.fn(), transaction: vi.fn(), create: vi.fn(),
  session: vi.fn(), project: vi.fn(), role: vi.fn(), plan: vi.fn(), receive: vi.fn(), drain: vi.fn(),
}));
vi.mock("../lib/db.js", () => ({ prisma: {
  checkInMonitor: { findFirst: mocks.findFirst, findMany: mocks.findMany, count: mocks.count, create: mocks.create },
  scheduledJobHeartbeat: { findUnique: mocks.heartbeat }, $transaction: mocks.transaction,
} }));
vi.mock("../lib/auth-session.js", () => ({ requireSessionUser: mocks.session }));
vi.mock("../lib/read-project-request.js", () => ({ resolveReadProjectIdWithSession: mocks.project }));
vi.mock("../lib/org-permissions.js", () => ({ getMembershipRoleForProject: mocks.role }));
vi.mock("../lib/plan-enforcement.js", () => ({ loadPlanContextForProject: mocks.plan }));
vi.mock("../lib/checkins.js", async importOriginal => ({ ...await importOriginal<typeof import("../lib/checkins.js")>(), receiveCheckIn: mocks.receive, drainCheckInNotices: mocks.drain }));
import { checkInPingRoutes, checkInManagementRoutes } from "./checkins.js";
const token = `ttc_${"a".repeat(64)}`;
const rid = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ id: "m", project_id: "p" });
  mocks.receive.mockResolvedValue("m"); mocks.drain.mockResolvedValue(undefined);
  mocks.session.mockResolvedValue({ userId: "u" }); mocks.project.mockResolvedValue("p"); mocks.role.mockResolvedValue("VIEWER");
});
afterEach(() => vi.unstubAllEnvs());
async function pingApp() { const app = Fastify(); await app.register(checkInPingRoutes, { prefix: "/checkin" }); return app; }
describe("check-in HTTP surface without ingest auth/quota", () => {
  it.each([["", "OK", null], ["/start", "START", null], ["/fail", "FAIL", null], ["/0", "OK", 0], ["/255", "FAIL", 255]])("accepts curl-friendly suffix %s", async (suffix, kind, exitCode) => {
    const app = await pingApp();
    for (const method of ["GET", "POST"] as const) {
      const response = await app.inject({ method, url: `/checkin/${token}${suffix}?rid=${rid}`, ...(method === "POST" ? { headers: { "content-type": "application/octet-stream" }, payload: "private user output" } : {}) });
      expect(response.statusCode).toBe(200); expect(response.body).toBe("OK"); expect(response.headers["cache-control"]).toBe("no-store");
      expect(mocks.receive).toHaveBeenLastCalledWith(expect.anything(), token, kind, rid, exitCode);
    }
    await app.close();
  });
  it("rejects malformed tokens, suffixes and run IDs", async () => {
    const app = await pingApp();
    for (const url of ["/checkin/wrong", `/checkin/${token}/256`, `/checkin/${token}/wat`]) expect((await app.inject(url)).statusCode).toBe(404);
    expect((await app.inject(`/checkin/${token}?rid=bad`)).statusCode).toBe(400); expect(mocks.receive).not.toHaveBeenCalled(); await app.close();
  });
  it("returns 404 for unknown or concurrently rotated secrets", async () => {
    const app = await pingApp(); mocks.findFirst.mockResolvedValueOnce(null);
    expect((await app.inject(`/checkin/${token}`)).statusCode).toBe(404);
    mocks.receive.mockResolvedValueOnce(null); expect((await app.inject(`/checkin/${token}`)).statusCode).toBe(404); await app.close();
  });
  it("ignores preview bots and HEAD without a DB write", async () => {
    const app = await pingApp();
    expect((await app.inject({ url: `/checkin/${token}`, headers: { "user-agent": "Slackbot-LinkExpanding" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "HEAD", url: `/checkin/${token}` })).statusCode).toBe(200);
    expect(mocks.receive).not.toHaveBeenCalled(); expect(mocks.findFirst).not.toHaveBeenCalled(); await app.close();
  });
  it("rate limits known monitors independently of ingest", async () => {
    const app = await pingApp();
    for (let i = 0; i < 12; i++) expect((await app.inject(`/checkin/${token}`)).statusCode).toBe(200);
    const limited = await app.inject(`/checkin/${token}`); expect(limited.statusCode).toBe(429); expect(limited.headers["retry-after"]).toBe("60"); expect(mocks.receive).toHaveBeenCalledTimes(12); await app.close();
  });
});
describe("check-in management authorization and plan cap", () => {
  it("never decrypts or returns secrets for a viewer", async () => {
    const app = Fastify(); await app.register(checkInManagementRoutes, { prefix: "/api" });
    mocks.findMany.mockResolvedValue([{ id: "m", status: "UP", token_hash: "hash", token_encrypted: "invalid ciphertext" }]); mocks.heartbeat.mockResolvedValue(null);
    const response = await app.inject("/api/project/checkin-monitors");
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ monitors: [{ id: "m", status: "UP" }], canEdit: false, evaluator: "unavailable" }); await app.close();
  });
  it.each(["", "/m/rotate-token", "/m/pause", "/m/resume"])("rejects viewer mutation %s", async suffix => {
    const app = Fastify(); await app.register(checkInManagementRoutes, { prefix: "/api" });
    expect((await app.inject({ method: "POST", url: `/api/project/checkin-monitors${suffix}`, payload: {} })).statusCode).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled(); await app.close();
  });
  it("enforces the monitor count under a project row lock", async () => {
    vi.stubEnv("CHECKIN_ENCRYPTION_KEY", "ab".repeat(32));
    const app = Fastify(); await app.register(checkInManagementRoutes, { prefix: "/api" }); mocks.role.mockResolvedValue("EDITOR");
    mocks.plan.mockResolvedValue({ limits: { maxCheckInMonitorsPerProject: 5 } }); mocks.count.mockResolvedValue(5);
    const lock = vi.fn(async () => []);
    mocks.transaction.mockImplementation(async fn => fn({ $queryRaw: lock, checkInMonitor: { count: mocks.count, create: mocks.create } }));
    const response = await app.inject({ method: "POST", url: "/api/project/checkin-monitors", payload: { name: "Backup", schedule_type: "INTERVAL", interval_seconds: 300 } });
    expect(response.statusCode).toBe(409); expect(lock).toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); await app.close();
  });
});
