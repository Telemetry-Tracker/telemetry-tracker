import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type CheckInMonitor, type CheckInKind } from "@prisma/client";
import { checkInTokenHash } from "./checkin-secrets.js";
import { deadlineFor, dueAfterPing, nextCheckInDue } from "./checkin-schedule.js";
import { fireProjectAlert } from "./alert-dispatch.js";
import { resolveDestinationIds } from "./alert-rules.js";

type Tx = Prisma.TransactionClient;
const activeProject = { deleted_at: null, organization: { deleted_at: null } };
export async function lockMonitor(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "CheckInMonitor" WHERE id = ${id} FOR UPDATE`;
}
export function canManageCheckIns(role: string | null): boolean {
  return role === "OWNER" || role === "EDITOR";
}
export async function enqueueCheckInTransition(tx: Tx, monitor: CheckInMonitor, down: boolean, at: Date, reason: string) {
  if (monitor.status === "PAUSED" || (down ? monitor.status === "DOWN" : monitor.status !== "DOWN")) return;
  const incident = down ? randomUUID() : monitor.incident_id!;
  await tx.checkInMonitor.update({ where: { id: monitor.id }, data: {
    status: down ? "DOWN" : "UP", down_since: down ? at : null, incident_id: down ? incident : null,
  } });
  await tx.checkInNotice.create({ data: {
    monitor_id: monitor.id, project_id: monitor.project_id,
    rule: down ? "CHECKIN_DOWN" : "CHECKIN_RECOVERED",
    dedupe_key: `checkin:${down ? "down" : "up"}:${monitor.id}:${incident}`,
    title: `${monitor.name}: ${down ? "down" : "recovered"}`,
    body: reason, destination_ids: monitor.destination_ids ?? [],
  } });
}
/** Durable intent survives a dispatcher failure or an API process restart.
 * The existing AlertEvent and email dedupe make concurrent drains safe. */
export async function drainCheckInNotices(prisma: PrismaClient, monitorId?: string): Promise<void> {
  for (;;) {
    const notices = await prisma.checkInNotice.findMany({ where: {
      delivered_at: null, ...(monitorId ? { monitor_id: monitorId } : {}),
      monitor: { deleted_at: null, project: activeProject },
    }, take: 100, orderBy: [{ created_at: "asc" }, { id: "asc" }] });
    if (!notices.length) return;
    for (const notice of notices) {
      await fireProjectAlert(prisma, {
        projectId: notice.project_id, rule: notice.rule, dedupeKey: notice.dedupe_key,
        title: notice.title, body: notice.body, href: "/dashboard/checkins",
        destinations: resolveDestinationIds(notice.destination_ids as string[]),
      });
      await prisma.checkInNotice.update({ where: { id: notice.id }, data: { delivered_at: new Date() } });
    }
  }
}

export async function receiveCheckIn(prisma: PrismaClient, token: string, kind: "START" | "OK" | "FAIL", rid: string | null, exitCode: number | null, now = new Date()): Promise<string | null> {
  const hash = checkInTokenHash(token);
  return prisma.$transaction(async tx => {
    const found = await tx.checkInMonitor.findUnique({ where: { token_hash: hash }, select: { id: true } });
    if (!found) return null;
    await lockMonitor(tx, found.id);
    // Recheck under the same lock as rotation/deletion; old credentials cannot
    // mutate a monitor once rotation has committed.
    const monitor = await tx.checkInMonitor.findFirst({ where: {
      id: found.id, token_hash: hash, deleted_at: null, project: activeProject,
    } });
    if (!monitor) return null;
    if (rid) {
      const duplicate = await tx.checkIn.findFirst({ where: { monitor_id: monitor.id, run_id: rid,
        kind: kind === "START" ? { in: ["START", "OK", "FAIL"] } : { in: ["OK", "FAIL"] },
      } });
      if (duplicate) return monitor.id;
    } else {
      const duplicate = await tx.checkIn.findFirst({ where: { monitor_id: monitor.id, run_id: null, kind,
        received_at: { gte: new Date(now.getTime() - 60_000) },
      } });
      if (duplicate) return monitor.id;
    }
    const runId = rid ?? "__default";
    const run = await tx.checkInRun.findUnique({ where: { monitor_id_run_id: { monitor_id: monitor.id, run_id: runId } } });
    if (rid && run?.finished_at) return monitor.id;
    const matches = run && !run.finished_at;
    await tx.checkIn.create({ data: {
      monitor_id: monitor.id, kind, run_id: rid, exit_code: exitCode, received_at: now,
      duration_ms: kind !== "START" && matches ? Math.min(2147483647, Math.max(0, now.getTime() - run.started_at.getTime())) : null,
    } });
    await tx.checkInMonitor.update({ where: { id: monitor.id }, data: { last_ping_at: now } });
    if (monitor.status === "PAUSED") return monitor.id;
    if (kind === "START") {
      // A repeated start must not postpone a timeout.
      if (!matches) await tx.checkInRun.upsert({
        where: { monitor_id_run_id: { monitor_id: monitor.id, run_id: runId } },
        create: { monitor_id: monitor.id, run_id: runId, started_at: now,
          timeout_at: monitor.max_runtime_seconds ? new Date(now.getTime() + monitor.max_runtime_seconds * 1000) : null },
        update: { started_at: now, finished_at: null,
          timeout_at: monitor.max_runtime_seconds ? new Date(now.getTime() + monitor.max_runtime_seconds * 1000) : null },
      });
      if (monitor.status === "NEW") {
        const due = dueAfterPing(monitor, now, monitor.next_due_at);
        await tx.checkInMonitor.update({ where: { id: monitor.id }, data: { status: "UP", next_due_at: due, deadline_at: deadlineFor(monitor, due) } });
      }
      return monitor.id;
    }
    if (matches) await tx.checkInRun.update({ where: { id: run.id }, data: { finished_at: now } });
    const due = dueAfterPing(monitor, now, monitor.next_due_at);
    await tx.checkInMonitor.update({ where: { id: monitor.id }, data: {
      next_due_at: due, deadline_at: deadlineFor(monitor, due),
      ...(kind === "OK" && monitor.status === "NEW" ? { status: "UP" } : {}),
    } });
    await enqueueCheckInTransition(tx, monitor, kind === "FAIL", now,
      kind === "FAIL" ? `Job reported failure${exitCode === null ? "" : ` (exit ${exitCode})`}.` : "Job reported success.");
    return monitor.id;
  });
}

export function evaluatorIsStale(last: Date | null | undefined, now: Date, intervalMinutes: number): boolean {
  return !last || now.getTime() - last.getTime() > intervalMinutes * 120_000;
}
/** Uses existing evaluator heartbeat. After a stale sweep or a platform-wide
 * ping gap, defer overdue work by one evaluator period. A persistent global
 * gap only gets one deferral, so real simultaneous outages still alert. */
export async function runCheckInSweep(prisma: PrismaClient, intervalMinutes: number, now = new Date()): Promise<void> {
  const heartbeat = await prisma.scheduledJobHeartbeat.findUnique({ where: { job: "alert-rules-evaluator" } });
  const stale = evaluatorIsStale(heartbeat?.last_ok_at, now, intervalMinutes);
  const recent = await prisma.checkIn.count({ where: { received_at: { gte: new Date(now.getTime() - intervalMinutes * 120_000) }, monitor: { deleted_at: null, status: { not: "PAUSED" }, project: activeProject } } });
  const guardJob = "checkin-global-outage-guard";
  const globalGuard = await prisma.scheduledJobHeartbeat.findUnique({ where: { job: guardJob } });
  const globalGap = recent === 0 && !globalGuard;
  if (recent > 0 && globalGuard) await prisma.scheduledJobHeartbeat.deleteMany({ where: { job: guardJob } });
  if (globalGap) await prisma.scheduledJobHeartbeat.upsert({ where: { job: guardJob }, create: { job: guardJob, last_ok_at: now }, update: { last_ok_at: now } });
  let cursor: string | undefined;
  for (;;) {
    const monitors = await prisma.checkInMonitor.findMany({ where: {
      deleted_at: null, status: { in: ["UP", "DOWN"] }, project: activeProject,
      ...(cursor ? { id: { gt: cursor } } : {}),
      OR: [{ deadline_at: { lte: now } }, { runs: { some: { finished_at: null, timeout_at: { lte: now } } } }],
    }, take: 100, orderBy: { id: "asc" }, select: { id: true } });
    if (!monitors.length) break;
    for (const candidate of monitors) await prisma.$transaction(async tx => {
      await lockMonitor(tx, candidate.id);
      const monitor = await tx.checkInMonitor.findFirst({ where: { id: candidate.id, deleted_at: null, status: { in: ["UP", "DOWN"] }, project: activeProject } });
      if (!monitor) return;
      const runs = await tx.checkInRun.findMany({ where: { monitor_id: monitor.id, finished_at: null, timeout_at: { lte: now } } });
      const missed = monitor.deadline_at && monitor.deadline_at <= now;
      if (stale || globalGap) {
        const defer = new Date(now.getTime() + intervalMinutes * 60_000);
        if (missed) await tx.checkInMonitor.update({ where: { id: monitor.id }, data: { deadline_at: defer } });
        if (runs.length) await tx.checkInRun.updateMany({ where: { id: { in: runs.map(r => r.id) } }, data: { timeout_at: defer } });
        return;
      }
      if (!missed && !runs.length) return;
      const kind: CheckInKind = runs.length ? "TIMEOUT" : "MISSED";
      for (const run of runs) {
        await tx.checkInRun.update({ where: { id: run.id }, data: { timeout_at: null } });
        await tx.checkIn.create({ data: { monitor_id: monitor.id, kind: "TIMEOUT", run_id: run.run_id === "__default" ? null : run.run_id, received_at: now } });
      }
      if (missed) {
        if (!runs.length) await tx.checkIn.create({ data: { monitor_id: monitor.id, kind: "MISSED", received_at: now } });
        const due = nextCheckInDue(monitor, now);
        await tx.checkInMonitor.update({ where: { id: monitor.id }, data: { next_due_at: due, deadline_at: deadlineFor(monitor, due) } });
      }
      await enqueueCheckInTransition(tx, monitor, true, now, kind === "TIMEOUT" ? "Job exceeded its maximum runtime." : `Expected check-in by ${monitor.deadline_at!.toISOString()} (${monitor.timezone}).`);
    });
    cursor = monitors[monitors.length - 1].id;
  }
  await drainCheckInNotices(prisma);
}

/** Nightly age retention plus a deterministic 1,000-row cap per monitor. */
export async function pruneCheckIns(tx: Tx, projectId: string, cutoff: Date, dryRun: boolean): Promise<number> {
  const ranked = Prisma.sql`
    SELECT c.id, c.received_at, ROW_NUMBER() OVER (PARTITION BY c.monitor_id ORDER BY c.received_at DESC, c.id DESC) AS position
    FROM "CheckIn" c JOIN "CheckInMonitor" m ON m.id = c.monitor_id WHERE m.project_id = ${projectId}`;
  let count: number;
  if (dryRun) {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM (${ranked}) ranked WHERE received_at < ${cutoff} OR position > 1000`;
    count = Number(rows[0]?.count ?? 0);
  } else {
    // Delete inside PostgreSQL rather than materializing an unbounded list of
    // expired IDs in the retention process or exceeding its parameter limit.
    count = await tx.$executeRaw`DELETE FROM "CheckIn" WHERE id IN (SELECT id FROM (${ranked}) ranked WHERE received_at < ${cutoff} OR position > 1000)`;
    await tx.checkInRun.deleteMany({ where: { monitor: { project_id: projectId }, OR: [{ finished_at: { lt: cutoff } }, { started_at: { lt: cutoff } }] } });
    await tx.checkInNotice.deleteMany({ where: { project_id: projectId, delivered_at: { not: null }, created_at: { lt: cutoff } } });
  }
  return count;
}
