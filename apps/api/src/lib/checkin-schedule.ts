import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

export const checkInConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  schedule_type: z.enum(["INTERVAL", "CRON"]),
  interval_seconds: z.number().int().min(300).max(366 * 86400).nullable().default(null),
  cron_expr: z.string().trim().max(120).nullable().default(null),
  timezone: z.string().max(80).default("UTC"),
  grace_seconds: z.number().int().min(60).max(86400).default(300),
  max_runtime_seconds: z.number().int().min(1).max(7 * 86400).nullable().default(null),
  destination_ids: z.array(z.string().min(1).max(100)).max(20).default(["project-email"]),
});
export type CheckInConfig = z.infer<typeof checkInConfigSchema>;
export type Schedule = Pick<CheckInConfig, "schedule_type" | "interval_seconds" | "cron_expr" | "timezone" | "grace_seconds">;

function cron(schedule: Schedule, at: Date) {
  return CronExpressionParser.parse(schedule.cron_expr!, { currentDate: at, tz: schedule.timezone });
}
export function validateCheckInSchedule(schedule: Schedule): void {
  new Intl.DateTimeFormat("en", { timeZone: schedule.timezone });
  if (schedule.schedule_type === "INTERVAL") {
    if (!schedule.interval_seconds || schedule.interval_seconds < 300) throw new Error("Interval must be at least 300 seconds");
    return;
  }
  if (!schedule.cron_expr || schedule.cron_expr.split(/\s+/).length !== 5) throw new Error("Use a five-field cron expression");
  const parsed = cron(schedule, new Date());
  // Inspect the minute field, including the wrap to the following hour. This
  // enforces the floor for every date, rather than sampling a few future runs.
  const minutes = parsed.fields.minute.values;
  for (let i = 0; i < minutes.length; i++) {
    const gap = (minutes[(i + 1) % minutes.length] + (i === minutes.length - 1 ? 60 : 0)) - minutes[i];
    if (gap < 5) throw new Error("Cron occurrences must be at least five minutes apart");
  }
  parsed.next(); // Reject schedules with no reachable occurrence.
}
export function nextCheckInDue(schedule: Schedule, at: Date): Date {
  if (schedule.schedule_type === "INTERVAL") return new Date(at.getTime() + schedule.interval_seconds! * 1000);
  return cron(schedule, at).next().toDate();
}
/** An early ping within grace satisfies the approaching slot; late pings
 * satisfy the latest elapsed slot. Never advance an existing deadline twice
 * for retries/extra pings in the same slot. */
export function dueAfterPing(schedule: Schedule, at: Date, currentDue: Date | null): Date {
  if (schedule.schedule_type === "INTERVAL") return nextCheckInDue(schedule, at);
  const slot = cron(schedule, new Date(at.getTime() + Math.min(schedule.grace_seconds, 60) * 1000 + 1)).prev().toDate();
  const next = nextCheckInDue(schedule, slot);
  return currentDue && currentDue > next ? currentDue : next;
}
export function deadlineFor(schedule: Schedule, due: Date): Date {
  return new Date(due.getTime() + schedule.grace_seconds * 1000);
}
