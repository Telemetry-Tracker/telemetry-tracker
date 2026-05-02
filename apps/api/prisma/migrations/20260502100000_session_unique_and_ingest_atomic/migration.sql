-- Remove duplicate logical sessions before enforcing idempotency at the database level.
-- Keep the newest row (matching the ingest close-path lookup) and preserve any end timestamp.
WITH ranked AS (
  SELECT
    id,
    project_id,
    session_id,
    app,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, session_id, app
      ORDER BY started_at DESC, id DESC
    ) AS rn,
    MAX(ended_at) OVER (PARTITION BY project_id, session_id, app) AS max_ended_at
  FROM "Session"
)
UPDATE "Session" AS s
SET ended_at = ranked.max_ended_at
FROM ranked
WHERE s.id = ranked.id
  AND ranked.rn = 1
  AND ranked.max_ended_at IS NOT NULL
  AND (s.ended_at IS NULL OR s.ended_at < ranked.max_ended_at);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, session_id, app
      ORDER BY started_at DESC, id DESC
    ) AS rn
  FROM "Session"
)
DELETE FROM "Session" AS s
USING ranked
WHERE s.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app");
