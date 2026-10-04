import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20261004120000_analytics_app_startup_view/migration.sql",
);

const migration = readFileSync(migrationPath, "utf8");

const exposedColumns = [
  "project_id",
  "app",
  "created_at",
  "platform",
  "sdk_version",
  "environment",
  "startup_path",
  "startup_complete",
  "startup_incomplete_reason",
  "app_version",
  "build_number",
  "token_refresh",
  "profile_cache",
  "rollover_ran",
  "js_startup_ms",
  "auth_bootstrap_start_ms",
  "auth_bootstrap_end_ms",
  "profile_ready_ms",
  "rollover_start_ms",
  "rollover_end_ms",
  "letters_ready_ms",
  "daily_goals_ready_ms",
  "game_state_ready_ms",
  "bootstrap_ready_ms",
  "shell_ready_ms",
  "splash_hidden_ms",
  "first_interaction_ms",
  "first_word_submit_ms",
  "dictionary_parse_ms",
  "dictionary_wait_ms",
];

describe("analytics_app_startup migration", () => {
  it("creates an owner-rights barrier view for besedna-igra app_startup only", () => {
    expect(migration).toContain("CREATE VIEW public.analytics_app_startup");
    expect(migration).toContain("security_barrier = true");
    expect(migration).toContain("security_invoker = false");
    expect(migration).toContain("e.name = 'app_startup'");
    expect(migration).toContain("e.app = 'besedna-igra'");
    expect(migration).not.toContain("security_invoker = true");
    expect(migration).not.toContain("CREATE ROLE");
    expect(migration).not.toContain("ALTER ROLE");
  });

  it("exposes only the allowlisted columns", () => {
    const selectList = migration.slice(
      migration.indexOf("SELECT"),
      migration.indexOf("FROM \"Event\""),
    );
    for (const column of exposedColumns) {
      expect(selectList).toContain(column);
    }
    expect(selectList).not.toMatch(/\bAS properties\b/);
    expect(selectList).not.toMatch(/\buser_id\b/);
    expect(selectList).not.toMatch(/\bsession_id\b/);
    expect(selectList).not.toMatch(/\banonymous_id\b/);
    expect(selectList).not.toMatch(/\brelease\b/);
    expect(selectList).not.toMatch(/\bAS os\b/);
  });

  it("nulls malformed property values instead of casting them directly", () => {
    expect(migration).toContain("jsonb_typeof(");
    expect(migration).toContain("ELSE NULL");
    expect(migration).not.toMatch(/properties->>'[a-z0-9_]+'\)::integer/);
    expect(migration).toContain("~ '^[0-9]{1,7}$'");
    expect(migration).toContain("~ '^[A-Za-z0-9._+-]{1,32}$'");
  });

  it("revokes PUBLIC and grants SELECT to analytics_ro only when that role exists", () => {
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.analytics_app_startup FROM PUBLIC",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.analytics_app_startup TO analytics_ro",
    );
    expect(migration).toContain("pg_roles WHERE rolname = 'analytics_ro'");
    expect(migration).not.toContain('GRANT SELECT ON "Event"');
    expect(migration).not.toContain("GRANT SELECT (properties");
  });
});
