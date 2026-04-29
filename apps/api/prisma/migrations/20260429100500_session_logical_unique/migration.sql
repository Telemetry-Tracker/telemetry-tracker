-- Consolidate historical duplicates before enforcing one row per logical session.
-- Keep the newest row for dashboard ordering, but preserve any recorded close time.
WITH keepers AS (
  SELECT DISTINCT ON (project_id, session_id, app)
    id,
    project_id,
    session_id,
    app
  FROM "Session"
  ORDER BY project_id, session_id, app, started_at DESC, id DESC
),
closed AS (
  SELECT
    project_id,
    session_id,
    app,
    MAX(ended_at) AS ended_at
  FROM "Session"
  WHERE ended_at IS NOT NULL
  GROUP BY project_id, session_id, app
)
UPDATE "Session" s
SET ended_at = closed.ended_at
FROM keepers
JOIN closed
  ON closed.project_id = keepers.project_id
  AND closed.session_id = keepers.session_id
  AND closed.app = keepers.app
WHERE s.id = keepers.id
  AND (s.ended_at IS NULL OR s.ended_at < closed.ended_at);

DELETE FROM "Session" s
USING "Session" keep
WHERE s.project_id = keep.project_id
  AND s.session_id = keep.session_id
  AND s.app = keep.app
  AND (
    keep.started_at > s.started_at
    OR (keep.started_at = s.started_at AND keep.id > s.id)
  );

CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app");
