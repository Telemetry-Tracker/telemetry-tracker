import { describe, expect, it } from "vitest";
import { checkInConfigSchema, validateCheckInSchedule, nextCheckInDue, dueAfterPing, deadlineFor } from "./checkin-schedule.js";
const config = checkInConfigSchema.parse({ name: "Backup", schedule_type: "INTERVAL", interval_seconds: 300 });
const cron = { ...config, schedule_type: "CRON" as const, cron_expr: "30 2 * * *", timezone: "Europe/Ljubljana" };
const at = new Date("2026-10-12T03:00:00Z");
describe("check-in schedules", () => {
  it("arms intervals from receive time and adds grace", () => {
    expect(nextCheckInDue(config, at).toISOString()).toBe("2026-10-12T03:05:00.000Z");
    expect(deadlineFor(config, nextCheckInDue(config, at)).toISOString()).toBe("2026-10-12T03:10:00.000Z");
  });
  it("follows IANA zones rather than server local time", () => {
    expect(nextCheckInDue(cron, at).toISOString()).toBe("2026-10-13T00:30:00.000Z");
  });
  it("handles spring DST: missing 02:30 becomes 03:30", () => {
    expect(nextCheckInDue(cron, new Date("2026-03-28T23:00Z")).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("handles autumn DST: repeated wall clock slot occurs once", () => {
    const first = nextCheckInDue(cron, new Date("2026-10-24T23:00Z"));
    expect(first.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(nextCheckInDue(cron, first).toISOString()).toBe("2026-10-26T01:30:00.000Z");
  });
  it("assigns slightly early, on-time and late cron pings to the same slot", () => {
    const schedule = { ...cron, cron_expr: "0 3 * * *", timezone: "UTC" };
    for (const time of ["02:59:59", "03:00:00", "03:04:00", "03:06:00"]) {
      expect(dueAfterPing(schedule, new Date(`2026-10-12T${time}Z`), at).toISOString()).toBe("2026-10-13T03:00:00.000Z");
    }
  });
  it("does not skip a five-minute cron slot on exact-time or repeated pings", () => {
    const schedule = { ...cron, cron_expr: "*/5 * * * *", timezone: "UTC" };
    const due = dueAfterPing(schedule, at, null);
    expect(due.toISOString()).toBe("2026-10-12T03:05:00.000Z");
    expect(dueAfterPing(schedule, new Date(at.getTime() + 20_000), due)).toEqual(due);
  });
  it.each(["* * * * *", "0,4 * * * *", "0,58 * * * *", "*/2 3 * * 1", "0 0 0 * * *", "invalid"])("rejects sub-five-minute or invalid cron %s", cron_expr => {
    expect(() => validateCheckInSchedule({ ...cron, cron_expr })).toThrow();
  });
  it("rejects invalid zones and missing interval", () => {
    expect(() => validateCheckInSchedule({ ...cron, timezone: "Moon/Sea" })).toThrow();
    expect(() => validateCheckInSchedule({ ...config, interval_seconds: null })).toThrow();
  });
  it("accepts valid five-minute cron", () => expect(() => validateCheckInSchedule({ ...cron, cron_expr: "*/5 * * * *" })).not.toThrow());
});
