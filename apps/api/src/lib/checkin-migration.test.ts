import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("adds isolated check-in tables without destructive statements or changing existing columns", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/20261012133000_checkin_monitors/migration.sql", import.meta.url), "utf8");
  expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE FROM|ALTER TABLE[^;]*\b(DROP|RENAME)\b)/im);
  expect(sql).not.toMatch(/ALTER TABLE "(Project|Organization|Event|Session|ApiKey|UsageMonthly)"/);
  for (const name of ["CheckInMonitor", "CheckIn", "CheckInRun", "CheckInNotice"]) expect(sql).toContain(`CREATE TABLE "${name}"`);
  expect(sql).toContain('"CheckInMonitor_token_hash_key"'); expect(sql).toContain('"CheckInMonitor_status_deadline_at_idx"');
  expect(sql).toContain('"CheckIn_monitor_id_run_id_kind_key"'); expect(sql).toContain('interval_seconds >= 300');
});
