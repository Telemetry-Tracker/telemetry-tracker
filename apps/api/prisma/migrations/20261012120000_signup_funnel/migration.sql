ALTER TABLE "User"
  ADD COLUMN "signup_channel" VARCHAR(32),
  ADD COLUMN "first_landing_path" VARCHAR(2048);
ALTER TABLE "Project" ADD COLUMN "first_event_at" TIMESTAMP(3);

-- Earliest surviving evidence. API key usage is a fallback only: authentication
-- can occur without accepted telemetry, and last_used_at is not a first-use time.
UPDATE "Project" p SET "first_event_at" = COALESCE(
  (SELECT min(evidence.at) FROM (
    SELECT min(e.created_at) AS at FROM "Event" e WHERE e.project_id = p.id
    UNION ALL
    SELECT min(o.created_at) FROM "ErrorOccurrence" o
      JOIN "ErrorGroup" g ON g.id = o.error_group_id WHERE g.project_id = p.id
    UNION ALL
    SELECT min(s.started_at) FROM "Session" s WHERE s.project_id = p.id
  ) evidence),
  (SELECT min(k.last_used_at) FROM "ApiKey" k WHERE k.project_id = p.id)
) WHERE p.first_event_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    GRANT SELECT (signup_channel, first_landing_path) ON "User" TO analytics_ro;
    GRANT SELECT (first_event_at) ON "Project" TO analytics_ro;
  END IF;
END $$;
