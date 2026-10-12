import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/db.js";
import { requireSessionUser } from "../lib/auth-session.js";
import { resolveReadProjectIdWithSession } from "../lib/read-project-request.js";
import { getMembershipRoleForProject } from "../lib/org-permissions.js";
import { checkInTokenHash, createCheckInSecret, decryptCheckInSecret } from "../lib/checkin-secrets.js";
import { CheckInRateLimiter, isCheckInPreviewBot } from "../lib/checkin-rate-limit.js";
import { canManageCheckIns, drainCheckInNotices, lockMonitor, receiveCheckIn, evaluatorIsStale } from "../lib/checkins.js";
import { checkInConfigSchema, nextCheckInDue, deadlineFor, validateCheckInSchedule } from "../lib/checkin-schedule.js";
import { loadPlanContextForProject } from "../lib/plan-enforcement.js";
import { resolveAlertRulesScheduleIntervalMinutes } from "../lib/alert-rules.js";
import type { CheckInMonitor } from "@prisma/client";

export function checkInMonitorView(m: CheckInMonitor, canEdit: boolean) {
  const { token_hash: _hash, token_encrypted: encrypted, ...row } = m;
  return { ...row, ...(canEdit ? { checkin_path: `/checkin/${decryptCheckInSecret(encrypted)}` } : {}) };
}

export async function checkInPingRoutes(app: FastifyInstance) {
  const limiter = new CheckInRateLimiter();
  // Ignore bodies regardless of content type; never parse/store customer output.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => { payload.resume(); payload.on("end", () => done(null, undefined)); payload.on("error", done); });
  const handler = async (request: FastifyRequest<{ Params: { token: string; action?: string }; Querystring: { rid?: string } }>, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store").type("text/plain");
    const { token, action } = request.params;
    if (!/^ttc_[a-f0-9]{64}$/.test(token)) return reply.code(404).send("Not found");
    let kind: "START" | "OK" | "FAIL" = "OK";
    let exitCode: number | null = null;
    if (action === "start") kind = "START";
    else if (action === "fail") kind = "FAIL";
    else if (action !== undefined) {
      if (!/^\d{1,3}$/.test(action) || Number(action) > 255) return reply.code(404).send("Not found");
      exitCode = Number(action); kind = exitCode === 0 ? "OK" : "FAIL";
    }
    const rid = request.query.rid ?? null;
    if (rid !== null && (typeof rid !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(rid))) return reply.code(400).send("Invalid rid");
    if (request.method === "HEAD" || isCheckInPreviewBot(request.headers["user-agent"] ?? "")) return reply.send("OK");
    const monitor = await prisma.checkInMonitor.findFirst({ where: {
      token_hash: checkInTokenHash(token), deleted_at: null,
      project: { deleted_at: null, organization: { deleted_at: null } },
    }, select: { id: true, project_id: true } });
    if (!monitor) return reply.code(404).send("Not found");
    if (!limiter.consume(monitor.id, monitor.project_id)) return reply.header("Retry-After", "60").code(429).send("Rate limited");
    const id = await receiveCheckIn(prisma, token, kind, rid, exitCode);
    if (!id) return reply.code(404).send("Not found");
    // Intent is already durable. The evaluator retries pending delivery.
    void drainCheckInNotices(prisma, id).catch(() => request.log.error("Check-in notification dispatch failed; evaluator will retry"));
    return reply.send("OK");
  };
  app.route({ method: ["GET", "POST", "HEAD"], url: "/:token", handler });
  app.route({ method: ["GET", "POST", "HEAD"], url: "/:token/:action", handler });
}

export async function checkInManagementRoutes(app: FastifyInstance) {
  async function scope(request: FastifyRequest, reply: FastifyReply, write = false) {
    const session = await requireSessionUser(request, reply);
    if (!session) return null;
    const projectId = await resolveReadProjectIdWithSession(request, reply, session);
    if (!projectId) return null;
    const canEdit = canManageCheckIns(await getMembershipRoleForProject(session.userId, projectId));
    if (write && !canEdit) { reply.code(403).send({ error: "Owner or editor required" }); return null; }
    return { projectId, canEdit };
  }
  app.get("/project/checkin-monitors", async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return;
    const [monitors, heartbeat] = await Promise.all([
      prisma.checkInMonitor.findMany({ where: { project_id: auth.projectId, deleted_at: null }, orderBy: { created_at: "asc" } }),
      prisma.scheduledJobHeartbeat.findUnique({ where: { job: "alert-rules-evaluator" } }),
    ]);
    reply.header("Cache-Control", "no-store");
    return { monitors: monitors.map(m => checkInMonitorView(m, auth.canEdit)), canEdit: auth.canEdit,
      evaluator: evaluatorIsStale(heartbeat?.last_ok_at, new Date(), resolveAlertRulesScheduleIntervalMinutes()) ? "unavailable" : "ok" };
  });
  async function config(raw: unknown, projectId: string) {
    const result = checkInConfigSchema.safeParse(raw);
    if (!result.success) return null;
    try { validateCheckInSchedule(result.data); } catch { return null; }
    const ids = result.data.destination_ids.filter(id => id !== "project-email");
    if (ids.length) {
      const count = await prisma.projectWebhook.count({ where: { project_id: projectId, id: { in: [...new Set(ids)] }, deleted_at: null } });
      if (count !== new Set(ids).size) return null;
    }
    return { ...result.data, interval_seconds: result.data.schedule_type === "INTERVAL" ? result.data.interval_seconds : null,
      cron_expr: result.data.schedule_type === "CRON" ? result.data.cron_expr : null };
  }
  app.post("/project/checkin-monitors", async (request, reply) => {
    const auth = await scope(request, reply, true); if (!auth) return;
    const data = await config(request.body, auth.projectId);
    if (!data) return reply.code(400).send({ error: "Invalid monitor schedule or destinations" });
    const plan = await loadPlanContextForProject(prisma, auth.projectId);
    if (!plan) return reply.code(404).send({ error: "Project not found" });
    const secret = createCheckInSecret();
    const monitor = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${auth.projectId} FOR UPDATE`;
      const count = await tx.checkInMonitor.count({ where: { project_id: auth.projectId, deleted_at: null } });
      if (count >= plan.limits.maxCheckInMonitorsPerProject) return null;
      return tx.checkInMonitor.create({ data: { ...data, ...secret, project_id: auth.projectId } });
    });
    if (!monitor) return reply.code(409).send({ error: "Monitor plan limit reached" });
    return reply.header("Cache-Control", "no-store").code(201).send(checkInMonitorView(monitor, true));
  });
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/project/checkin-monitors/:id/checkins", async (request, reply) => {
    const auth = await scope(request, reply); if (!auth) return;
    const monitor = await prisma.checkInMonitor.findFirst({ where: { id: request.params.id, project_id: auth.projectId, deleted_at: null }, select: { id: true } });
    if (!monitor) return reply.code(404).send({ error: "Monitor not found" });
    const limit = Number(request.query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return reply.code(400).send({ error: "Invalid limit" });
    return { checkins: await prisma.checkIn.findMany({ where: { monitor_id: monitor.id }, orderBy: [{ received_at: "desc" }, { id: "desc" }], take: limit }) };
  });
  for (const action of ["edit", "delete", "rotate-token", "pause", "resume"] as const) {
    app.route<{ Params: { id: string } }>({
      method: action === "edit" ? "PATCH" : action === "delete" ? "DELETE" : "POST",
      url: `/project/checkin-monitors/:id${["edit", "delete"].includes(action) ? "" : `/${action}`}`,
      handler: async (request, reply) => {
        const auth = await scope(request, reply, true); if (!auth) return;
        const data = action === "edit" ? await config(request.body, auth.projectId) : null;
        if (action === "edit" && !data) return reply.code(400).send({ error: "Invalid monitor schedule or destinations" });
        const result = await prisma.$transaction(async tx => {
          await lockMonitor(tx, request.params.id);
          const monitor = await tx.checkInMonitor.findFirst({ where: { id: request.params.id, project_id: auth.projectId, deleted_at: null } });
          if (!monitor) return null;
          const now = new Date();
          if (action === "delete") {
            await tx.checkInNotice.updateMany({ where: { monitor_id: monitor.id, delivered_at: null }, data: { delivered_at: now } });
            return tx.checkInMonitor.update({ where: { id: monitor.id }, data: { deleted_at: now } });
          }
          if (action === "rotate-token") return tx.checkInMonitor.update({ where: { id: monitor.id }, data: createCheckInSecret() });
          if (action === "pause" || action === "resume") {
            await tx.checkInRun.updateMany({ where: { monitor_id: monitor.id, finished_at: null }, data: { finished_at: now } });
            const due = nextCheckInDue(monitor, now);
            return tx.checkInMonitor.update({ where: { id: monitor.id }, data: { status: action === "pause" ? "PAUSED" : "NEW", down_since: null, incident_id: null,
              next_due_at: action === "pause" ? null : due, deadline_at: null } });
          }
          const due = nextCheckInDue(data!, now);
          return tx.checkInMonitor.update({ where: { id: monitor.id }, data: { ...data!, next_due_at: due,
            deadline_at: ["NEW", "PAUSED"].includes(monitor.status) ? null : deadlineFor(data!, due) } });
        });
        if (!result) return reply.code(404).send({ error: "Monitor not found" });
        return reply.header("Cache-Control", "no-store").send(action === "delete" ? { ok: true } : checkInMonitorView(result, true));
      },
    });
  }
}
