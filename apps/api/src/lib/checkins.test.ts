import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckInMonitor, PrismaClient } from "@prisma/client";
import { checkInTokenHash } from "./checkin-secrets.js";
import { receiveCheckIn, runCheckInSweep, drainCheckInNotices, pruneCheckIns } from "./checkins.js";
const { fire } = vi.hoisted(() => ({ fire: vi.fn(async () => true) }));
vi.mock("./alert-dispatch.js", () => ({ fireProjectAlert: fire }));
const token = `ttc_${"a".repeat(64)}`;
const now = new Date("2026-10-12T03:00:00Z");
const rid1 = "10000000-0000-4000-8000-000000000001";
const rid2 = "10000000-0000-4000-8000-000000000002";

/** Store used to exercise real transition code, not to simulate SQL locking.
 * Row-lock/concurrent cases are covered by the DB integration suite. */
function store() {
  const monitor = { id: "m", project_id: "p", name: "Backup", token_hash: checkInTokenHash(token), token_encrypted: "encrypted", schedule_type: "INTERVAL", interval_seconds: 300, cron_expr: null, timezone: "UTC", grace_seconds: 60, max_runtime_seconds: 30, destination_ids: ["project-email"], status: "NEW", last_ping_at: null, next_due_at: null, deadline_at: null, down_since: null, deleted_at: null, created_at: now, updated_at: now } as CheckInMonitor;
  const checkins: Record<string, unknown>[] = [];
  const runs: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
  let heartbeat: Date | null = now;
  let guard: Date | null = null;
  let recent = 1;
  const tx = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    checkInMonitor: {
      findUnique: vi.fn(async ({ where }) => where.token_hash === monitor.token_hash ? { id: monitor.id } : null),
      findFirst: vi.fn(async ({ where }) => monitor.deleted_at || (where.token_hash && where.token_hash !== monitor.token_hash) || (where.status && !where.status.in.includes(monitor.status)) ? null : { ...monitor }),
      update: vi.fn(async ({ data }) => Object.assign(monitor, data)),
      findMany: vi.fn(async ({ where }) => where.id?.gt || !["UP", "DOWN"].includes(monitor.status) || monitor.deleted_at ? [] : [{ id: monitor.id }]),
    },
    checkIn: {
      create: vi.fn(async ({ data }) => { const row = { id: String(checkins.length), ...data }; checkins.push(row); return row; }),
      findFirst: vi.fn(async ({ where }) => checkins.find(c => c.run_id === where.run_id && (typeof where.kind === "string" ? c.kind === where.kind : where.kind.in.includes(c.kind)) && (!where.received_at || (c.received_at as Date) >= where.received_at.gte)) ?? null),
      count: vi.fn(async () => recent),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    checkInRun: {
      findUnique: vi.fn(async ({ where }) => runs.find(r => r.run_id === where.monitor_id_run_id.run_id) ?? null),
      upsert: vi.fn(async ({ create, update, where }) => { const row = runs.find(r => r.run_id === where.monitor_id_run_id.run_id); if (row) return Object.assign(row, update); const next = { id: String(runs.length), finished_at: null, ...create }; runs.push(next); return next; }),
      update: vi.fn(async ({ where, data }) => Object.assign(runs.find(r => r.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }) => { runs.filter(r => where.id.in.includes(r.id)).forEach(r => Object.assign(r, data)); return { count: 1 }; }),
      findMany: vi.fn(async ({ where }) => runs.filter(r => !r.finished_at && r.timeout_at && (r.timeout_at as Date) <= where.timeout_at.lte)),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    checkInNotice: {
      create: vi.fn(async ({ data }) => { const row = { id: String(notices.length), delivered_at: null, ...data }; notices.push(row); return row; }),
      findMany: vi.fn(async () => notices.filter(n => !n.delivered_at)),
      update: vi.fn(async ({ where, data }) => Object.assign(notices.find(n => n.id === where.id)!, data)),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    scheduledJobHeartbeat: {
      findUnique: vi.fn(async ({ where }) => { const at = where.job === "alert-rules-evaluator" ? heartbeat : guard; return at ? { last_ok_at: at } : null; }),
      upsert: vi.fn(async ({ create }) => { guard = create.last_ok_at; return {}; }),
      deleteMany: vi.fn(async () => { guard = null; return { count: 1 }; }),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async fn => fn(tx)) } as unknown as PrismaClient;
  return { db, tx, monitor, checkins, runs, notices, setHeartbeat(at: Date | null) { heartbeat = at; }, setRecent(n: number) { recent = n; } };
}
beforeEach(() => fire.mockClear());
describe("check-in state machine and evaluator", () => {
  it("rejects missing/rotated/deleted credentials without recording a ping", async () => {
    const s = store();
    expect(await receiveCheckIn(s.db, "wrong", "OK", null, null, now)).toBeNull();
    s.monitor.token_hash = "rotated";
    expect(await receiveCheckIn(s.db, token, "OK", null, null, now)).toBeNull();
    expect(s.checkins).toHaveLength(0);
  });
  it("arms on success, never records IP/body, and uses server receive time", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "OK", rid1, 0, now);
    expect(s.monitor.status).toBe("UP"); expect(s.monitor.deadline_at).toEqual(new Date(now.getTime() + 360_000));
    expect(Object.keys(s.checkins[0]).sort()).toEqual(["duration_ms", "exit_code", "id", "kind", "monitor_id", "received_at", "run_id"].sort());
  });
  it("is idempotent for terminal run IDs, including changed terminal signals", async () => {
    const s = store();
    await receiveCheckIn(s.db, token, "FAIL", rid1, 42, now);
    await receiveCheckIn(s.db, token, "FAIL", rid1, 42, now);
    await receiveCheckIn(s.db, token, "OK", rid1, null, now);
    expect(s.checkins).toHaveLength(1); expect(s.notices).toHaveLength(1); expect(s.monitor.status).toBe("DOWN");
  });
  it("retains run idempotency after history rows are capped away", async () => {
    const s = store();
    await receiveCheckIn(s.db, token, "START", rid1, null, now);
    await receiveCheckIn(s.db, token, "OK", rid1, 0, new Date(now.getTime() + 1000));
    s.checkins.splice(0);
    const deadline = s.monitor.deadline_at;
    await receiveCheckIn(s.db, token, "OK", rid1, 0, new Date(now.getTime() + 2000));
    expect(s.checkins).toHaveLength(0); expect(s.monitor.deadline_at).toEqual(deadline);
  });
  it("sends one down and one recovery per outage through the existing dispatcher", async () => {
    const s = store();
    await receiveCheckIn(s.db, token, "FAIL", rid1, 1, now);
    await receiveCheckIn(s.db, token, "FAIL", rid2, 2, new Date(now.getTime() + 1000));
    await receiveCheckIn(s.db, token, "OK", null, 0, new Date(now.getTime() + 2000));
    await drainCheckInNotices(s.db); await drainCheckInNotices(s.db);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire.mock.calls.map(call => (call as unknown[])[1])).toEqual([
      expect.objectContaining({ rule: "CHECKIN_DOWN", dedupeKey: expect.stringMatching(/^checkin:down:m:/), destinations: { email: true, webhookIds: [] } }),
      expect.objectContaining({ rule: "CHECKIN_RECOVERED", dedupeKey: expect.stringMatching(/^checkin:up:m:/) }),
    ]);
  });
  it("distinguishes two outages even within the same millisecond", async () => {
    const s = store();
    await receiveCheckIn(s.db, token, "FAIL", rid1, 1, now);
    await receiveCheckIn(s.db, token, "OK", rid2, 0, now);
    await receiveCheckIn(s.db, token, "FAIL", "10000000-0000-4000-8000-000000000003", 1, now);
    expect(new Set(s.notices.map(n => n.dedupe_key)).size).toBe(3);
  });
  it("does not lose notification intent when dispatch fails", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "FAIL", rid1, null, now);
    fire.mockRejectedValueOnce(new Error("dispatch failed"));
    await expect(drainCheckInNotices(s.db)).rejects.toThrow();
    expect(s.notices[0].delivered_at).toBeNull();
    await drainCheckInNotices(s.db); expect(s.notices[0].delivered_at).toBeInstanceOf(Date);
  });
  it("records paused signals without arming or alerting", async () => {
    const s = store(); s.monitor.status = "PAUSED";
    await receiveCheckIn(s.db, token, "START", rid1, null, now);
    await receiveCheckIn(s.db, token, "FAIL", rid1, 1, now);
    expect(s.monitor.status).toBe("PAUSED"); expect(s.monitor.deadline_at).toBeNull(); expect(s.runs).toHaveLength(0); expect(s.notices).toHaveLength(0);
  });
  it("detects a start without finish, and repeated starts cannot postpone its timeout", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "START", rid1, null, now);
    await receiveCheckIn(s.db, token, "START", rid1, null, new Date(now.getTime() + 20_000));
    const later = new Date(now.getTime() + 31_000);
    await runCheckInSweep(s.db, 5, later); await runCheckInSweep(s.db, 5, later);
    expect(s.monitor.status).toBe("DOWN"); expect(s.checkins.filter(c => c.kind === "TIMEOUT")).toHaveLength(1); expect(fire).toHaveBeenCalledTimes(1);
  });
  it("finishing one overlapping run leaves the other run's timeout active", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "START", rid1, null, now); await receiveCheckIn(s.db, token, "START", rid2, null, now);
    await receiveCheckIn(s.db, token, "OK", rid1, 0, new Date(now.getTime() + 10_000));
    expect(s.checkins[2].duration_ms).toBe(10_000);
    await runCheckInSweep(s.db, 5, new Date(now.getTime() + 31_000));
    expect(s.checkins.find(c => c.kind === "TIMEOUT")?.run_id).toBe(rid2); expect(s.monitor.status).toBe("DOWN");
  });
  it("detects missed deadlines once and a later ping recovers", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "OK", rid1, 0, now);
    const later = new Date(now.getTime() + 361_000); await runCheckInSweep(s.db, 5, later); await runCheckInSweep(s.db, 5, later);
    expect(s.checkins.filter(c => c.kind === "MISSED")).toHaveLength(1); expect(fire).toHaveBeenCalledTimes(1);
    await receiveCheckIn(s.db, token, "OK", rid2, null, later); await drainCheckInNotices(s.db);
    expect(s.monitor.status).toBe("UP"); expect(fire).toHaveBeenCalledTimes(2);
  });
  it("defers overdue work after evaluator downtime", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "OK", rid1, 0, now); s.setHeartbeat(null);
    const later = new Date(now.getTime() + 361_000); await runCheckInSweep(s.db, 5, later);
    expect(s.monitor.status).toBe("UP"); expect(s.monitor.deadline_at).toEqual(new Date(later.getTime() + 300_000)); expect(fire).not.toHaveBeenCalled();
    s.setHeartbeat(later); await runCheckInSweep(s.db, 5, new Date(later.getTime() + 300_001)); expect(s.monitor.status).toBe("DOWN");
  });
  it("defers a global ping gap once, then alerts a persistent outage", async () => {
    const s = store(); await receiveCheckIn(s.db, token, "OK", rid1, 0, now); s.setRecent(0);
    const later = new Date(now.getTime() + 361_000); await runCheckInSweep(s.db, 5, later);
    expect(s.monitor.status).toBe("UP");
    s.setHeartbeat(later); await runCheckInSweep(s.db, 5, new Date(later.getTime() + 300_001)); expect(s.monitor.status).toBe("DOWN");
  });
  it("retention caps history, honors dry run, and removes old run/outbox rows", async () => {
    const s = store(); s.tx.$queryRaw.mockResolvedValueOnce([{ count: 1n }] as never);
    expect(await pruneCheckIns(s.tx as never, "p", now, true)).toBe(1); expect(s.tx.$executeRaw).not.toHaveBeenCalled();
    s.tx.$executeRaw.mockResolvedValueOnce(1);
    expect(await pruneCheckIns(s.tx as never, "p", now, false)).toBe(1); expect(s.tx.$executeRaw).toHaveBeenCalled();
    expect(s.tx.checkInRun.deleteMany).toHaveBeenCalled(); expect(s.tx.checkInNotice.deleteMany).toHaveBeenCalled();
  });
});
