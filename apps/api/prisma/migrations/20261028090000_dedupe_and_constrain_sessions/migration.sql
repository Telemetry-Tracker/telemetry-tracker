-- Dedupe existing Session rows before adding unique constraint.
-- Strategy: keep the earliest session per (project_id, session_id), merge ended_at, delete duplicates.

-- Step 1: Merge ended_at into the earliest session if any duplicate has it
UPDATE "Session" s
SET ended_at = agg.latest_ended_at
FROM (
  SELECT 
    project_id,
    session_id,
    MIN(id) as keep_id,
    MAX(ended_at) as latest_ended_at
  FROM "Session"
  GROUP BY project_id, session_id
  HAVING COUNT(*) > 1
) agg
WHERE s.id = agg.keep_id
  AND agg.latest_ended_at IS NOT NULL
  AND s.ended_at IS NULL;

-- Step 2: Delete all duplicate sessions except the one with the smallest id (first inserted)
DELETE FROM "Session" s
USING (
  SELECT 
    project_id,
    session_id,
    MIN(id) as keep_id
  FROM "Session"
  GROUP BY project_id, session_id
  HAVING COUNT(*) > 1
) agg
WHERE s.project_id = agg.project_id
  AND s.session_id = agg.session_id
  AND s.id != agg.keep_id;

-- Step 3: Add unique constraint on (project_id, session_id)
CREATE UNIQUE INDEX "Session_project_id_session_id_key" ON "Session"("project_id", "session_id");
