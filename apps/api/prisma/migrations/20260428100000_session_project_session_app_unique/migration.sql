-- Enforce ingest session idempotency at the database boundary.
CREATE TEMP TABLE "_Session_dedup" ON COMMIT DROP AS
SELECT
  id,
  FIRST_VALUE(id) OVER (
    PARTITION BY project_id, session_id, app
    ORDER BY started_at ASC, id ASC
  ) AS keep_id,
  MAX(ended_at) OVER (PARTITION BY project_id, session_id, app) AS max_ended_at
FROM "Session";

UPDATE "Session" s
SET ended_at = d.max_ended_at
FROM "_Session_dedup" d
WHERE s.id = d.keep_id
  AND d.max_ended_at IS NOT NULL;

DELETE FROM "Session" s
USING "_Session_dedup" d
WHERE s.id = d.id
  AND d.id <> d.keep_id;

CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app");
