import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { prisma } from "./lib/db.js";
import { createCheckInSecret, decryptCheckInSecret } from "./lib/checkin-secrets.js";
import { drainCheckInNotices, pruneCheckIns, runCheckInSweep } from "./lib/checkins.js";

describe.skipIf(process.env.RUN_DB_INTEGRATION_TESTS !== "true")("check-ins database integration", () => {
  let app: FastifyInstance;
  let orgId: string;
  let projectId: string;
  let ownerId: string;
  let viewerId: string;
  let ownerSession: string;
  let viewerSession: string;
  const config = { name: "Backup", schedule_type: "INTERVAL" as const, interval_seconds: 300, grace_seconds: 60, destination_ids: [] };
  beforeEach(async () => {
    vi.stubEnv("CHECKIN_ENCRYPTION_KEY", "ab".repeat(32));
    const org = await prisma.organization.create({ data: { name: "Check-in test", projects: { create: { name: "Jobs", slug: randomUUID() } } }, include: { projects: true } });
    orgId = org.id; projectId = org.projects[0].id;
    async function user(role: "OWNER" | "VIEWER") {
      return prisma.user.create({ data: { email: `${randomUUID()}@checkin.test`, password_hash: "not-a-login", memberships: { create: { organization_id: orgId, role } }, sessions: { create: { expires_at: new Date(Date.now() + 3600_000) } } }, include: { sessions: true } });
    }
    const owner = await user("OWNER"); const viewer = await user("VIEWER");
    ownerId = owner.id; ownerSession = owner.sessions[0].id; viewerId = viewer.id; viewerSession = viewer.sessions[0].id;
    app = await createApp();
  });
  afterEach(async () => {
    // Wait for durable pending notices before tearing down their project.
    if (projectId) {
      const monitors = await prisma.checkInMonitor.findMany({ where: { project_id: projectId }, select: { id: true } });
      for (const m of monitors) await drainCheckInNotices(prisma, m.id);
    }
    if (app) await app.close();
    if (orgId) await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId].filter(Boolean) } } });
    vi.unstubAllEnvs();
  });
  const headers = (session: string) => ({ authorization: `Bearer ${session}`, "x-project-id": projectId });
  async function create(extra = {}) {
    return prisma.checkInMonitor.create({ data: { ...config, ...createCheckInSecret(), project_id: projectId, ...extra } });
  }
  const path = (encrypted: string) => `/checkin/${decryptCheckInSecret(encrypted)}`;
  it("authenticates only by secret and never increments ingest quota or stores body/IP", async () => {
    const m = await create();
    const response = await app.inject({ method: "POST", url: `${path(m.token_encrypted)}/0`, headers: { "content-type": "text/plain" }, payload: "customer private output", remoteAddress: "203.0.113.17" });
    expect(response.statusCode).toBe(200);
    expect(await prisma.usageMonthly.count({ where: { project_id: projectId } })).toBe(0);
    const rows = await prisma.checkIn.findMany({ where: { monitor_id: m.id } });
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toMatch(/customer private output|203\.0\.113\.17/);
    expect((await app.inject("/checkin/unknown")).statusCode).toBe(404);
  });
  it("rotation invalidates the old secret and owners can still retrieve the new URL", async () => {
    const m = await create(); const old = path(m.token_encrypted);
    const rotated = await app.inject({ method: "POST", url: `/api/project/checkin-monitors/${m.id}/rotate-token`, headers: headers(ownerSession) });
    expect(rotated.statusCode).toBe(200);
    expect((await app.inject(old)).statusCode).toBe(404);
    expect((await app.inject(rotated.json().checkin_path)).statusCode).toBe(200);
    const list = await app.inject({ url: "/api/project/checkin-monitors", headers: headers(ownerSession) });
    expect(list.json().monitors[0].checkin_path).toBe(rotated.json().checkin_path);
    expect(JSON.stringify(list.json())).not.toContain("token_encrypted");
  });
  it.each(["rotate-token", "pause", "resume", "delete"] as const)("requires no JSON header for body-less %s requests", async action => {
    const m = await create();
    const method = action === "delete" ? "DELETE" : "POST";
    const url = `/api/project/checkin-monitors/${m.id}${action === "delete" ? "" : `/${action}`}`;
    // The old dashboard request is rejected by Fastify before reaching the handler.
    const rejected = await app.inject({ method, url, headers: { ...headers(ownerSession), "content-type": "application/json" } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe("FST_ERR_CTP_EMPTY_JSON_BODY");
    expect(await prisma.checkInMonitor.findUnique({ where: { id: m.id } })).toMatchObject({
      status: "NEW", deleted_at: null, token_hash: m.token_hash,
    });
    const response = await app.inject({ method, url, headers: headers(ownerSession) });
    expect(response.statusCode).toBe(200);
    if (action === "delete") {
      expect(response.json()).toEqual({ ok: true });
      expect((await prisma.checkInMonitor.findUniqueOrThrow({ where: { id: m.id } })).deleted_at).not.toBeNull();
    } else if (action === "rotate-token") {
      expect(response.json().checkin_path).not.toBe(path(m.token_encrypted));
    } else {
      expect(response.json().status).toBe(action === "pause" ? "PAUSED" : "NEW");
    }
  });
  it("viewers see history/status but cannot view URLs or mutate monitors", async () => {
    const m = await create(); const read = await app.inject({ url: "/api/project/checkin-monitors", headers: headers(viewerSession) });
    expect(read.statusCode).toBe(200); expect(read.json().monitors[0].status).toBe("NEW"); expect(read.json().monitors[0].checkin_path).toBeUndefined();
    for (const action of ["pause", "rotate-token"]) expect((await app.inject({ method: "POST", url: `/api/project/checkin-monitors/${m.id}/${action}`, headers: headers(viewerSession) })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/project/checkin-monitors/${m.id}`, headers: headers(viewerSession) })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/project/checkin-monitors/${m.id}/checkins`, headers: headers(viewerSession) })).statusCode).toBe(200);
  });
  it("editors have the same management permission as owners", async () => {
    await prisma.organizationMembership.update({ where: { user_id_organization_id: { user_id: viewerId, organization_id: orgId } }, data: { role: "EDITOR" } });
    const result = await app.inject({ method: "POST", url: "/api/project/checkin-monitors", headers: headers(viewerSession), payload: config });
    expect(result.statusCode).toBe(201); expect(result.json().checkin_path).toMatch(/^\/checkin\/ttc_/);
  });
  it("enforces Free limits atomically across concurrent creates", async () => {
    for (let i = 0; i < 4; i++) await create();
    const results = await Promise.all([1, 2].map(() => app.inject({ method: "POST", url: "/api/project/checkin-monitors", headers: headers(ownerSession), payload: config })));
    expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.checkInMonitor.count({ where: { project_id: projectId } })).toBe(5);
  });
  it("concurrent retry requests produce one failure row and one alert", async () => {
    const m = await create(); const rid = randomUUID();
    const requests = await Promise.all([1, 2, 3].map(() => app.inject(`${path(m.token_encrypted)}/fail?rid=${rid}`)));
    expect(requests.every(r => r.statusCode === 200)).toBe(true);
    await drainCheckInNotices(prisma, m.id);
    expect(await prisma.checkIn.count({ where: { monitor_id: m.id, kind: "FAIL" } })).toBe(1);
    expect(await prisma.alertEvent.count({ where: { project_id: projectId, rule: "CHECKIN_DOWN" } })).toBe(1);
    await app.inject(`${path(m.token_encrypted)}?rid=${randomUUID()}`); await drainCheckInNotices(prisma, m.id);
    expect(await prisma.alertEvent.count({ where: { project_id: projectId, rule: "CHECKIN_RECOVERED" } })).toBe(1);
  });
  it("paused monitors accept history but never go down", async () => {
    const m = await create({ status: "PAUSED" });
    await app.inject(`${path(m.token_encrypted)}/fail`);
    expect((await prisma.checkInMonitor.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("PAUSED");
    expect(await prisma.checkInNotice.count({ where: { monitor_id: m.id } })).toBe(0);
  });
  it("overlapping runs retain independent timeout deadlines", async () => {
    const m = await create({ max_runtime_seconds: 30 }); const a = randomUUID(), b = randomUUID();
    await app.inject(`${path(m.token_encrypted)}/start?rid=${a}`); await app.inject(`${path(m.token_encrypted)}/start?rid=${b}`); await app.inject(`${path(m.token_encrypted)}?rid=${a}`);
    const open = await prisma.checkInRun.findMany({ where: { monitor_id: m.id, finished_at: null } });
    expect(open).toHaveLength(1); expect(open[0].run_id).toBe(b);
  });
  it("ignores bots and rate limits pings", async () => {
    const m = await create(); const url = path(m.token_encrypted);
    await app.inject({ url, headers: { "user-agent": "Discordbot" } }); expect(await prisma.checkIn.count({ where: { monitor_id: m.id } })).toBe(0);
    for (let i = 0; i < 12; i++) expect((await app.inject(url)).statusCode).toBe(200);
    expect((await app.inject(url)).statusCode).toBe(429);
  });
  it("prunes by age and row cap without touching project data, including dry-run", async () => {
    const m = await create(); const now = new Date();
    await prisma.checkIn.createMany({ data: Array.from({ length: 1005 }, (_, i) => ({ monitor_id: m.id, kind: "OK" as const, received_at: new Date(now.getTime() - i * 1000) })) });
    await prisma.$transaction(async tx => expect(await pruneCheckIns(tx, projectId, new Date(now.getTime() - 86400_000), true)).toBe(5));
    expect(await prisma.checkIn.count({ where: { monitor_id: m.id } })).toBe(1005);
    await prisma.$transaction(async tx => expect(await pruneCheckIns(tx, projectId, new Date(now.getTime() - 86400_000), false)).toBe(5));
    expect(await prisma.checkIn.count({ where: { monitor_id: m.id } })).toBe(1000);
    expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: ownerId } })).not.toBeNull();
  });
  it("rejects deleted monitors without storing another ping", async () => {
    const m = await create(); await prisma.checkInMonitor.update({ where: { id: m.id }, data: { deleted_at: new Date() } });
    expect((await app.inject(path(m.token_encrypted))).statusCode).toBe(404); expect(await prisma.checkIn.count({ where: { monitor_id: m.id } })).toBe(0);
  });
  it("concurrent evaluator sweeps create exactly one missed transition", async () => {
    const m = await create(); await app.inject(path(m.token_encrypted));
    const now = new Date();
    await prisma.checkInMonitor.update({ where: { id: m.id }, data: { deadline_at: new Date(now.getTime() - 1000) } });
    await prisma.scheduledJobHeartbeat.upsert({ where: { job: "alert-rules-evaluator" }, create: { job: "alert-rules-evaluator", last_ok_at: now }, update: { last_ok_at: now } });
    await Promise.all([runCheckInSweep(prisma, 5, now), runCheckInSweep(prisma, 5, now)]);
    expect(await prisma.checkIn.count({ where: { monitor_id: m.id, kind: "MISSED" } })).toBe(1);
    expect(await prisma.alertEvent.count({ where: { project_id: projectId, rule: "CHECKIN_DOWN" } })).toBe(1);
  });
});
