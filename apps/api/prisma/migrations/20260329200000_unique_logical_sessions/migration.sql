-- Backfill older data before enforcing the logical session identity. Keep the
-- oldest row and preserve any close timestamp from duplicate retries.
CREATE TEMP TABLE duplicate_sessions_to_merge ON COMMIT DROP AS
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY project_id, session_id, app
      ORDER BY started_at ASC, id ASC
    ) AS keeper_id,
    MAX(ended_at) OVER (PARTITION BY project_id, session_id, app) AS merged_ended_at
  FROM "Session";

WITH
sessions_to_update AS (
  SELECT DISTINCT keeper_id, merged_ended_at
  FROM duplicate_sessions_to_merge
  WHERE merged_ended_at IS NOT NULL
)
UPDATE "Session" AS s
SET ended_at = sessions_to_update.merged_ended_at
FROM sessions_to_update
WHERE s.id = sessions_to_update.keeper_id
  AND (s.ended_at IS NULL OR s.ended_at < sessions_to_update.merged_ended_at);

DELETE FROM "Session"
USING duplicate_sessions_to_merge
WHERE "Session".id = duplicate_sessions_to_merge.id
  AND duplicate_sessions_to_merge.id <> duplicate_sessions_to_merge.keeper_id;

CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app");
