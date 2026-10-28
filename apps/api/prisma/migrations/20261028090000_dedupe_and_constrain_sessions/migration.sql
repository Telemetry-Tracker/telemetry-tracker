-- Dedupe existing Session rows before adding unique constraint on (project_id, session_id, app).
-- Strategy: keep earliest session by (started_at, id), merge all fields from duplicates, delete rest.

BEGIN;

-- Drop old two-column constraint if it exists from a previous partial migration
DROP INDEX IF EXISTS "Session_project_id_session_id_key";

-- Step 1: Identify the canonical row to keep per (project_id, session_id, app)
-- Use ROW_NUMBER() to deterministically select earliest by started_at, then id
CREATE TEMP TABLE sessions_to_keep AS
SELECT id
FROM (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, session_id, app 
      ORDER BY started_at ASC, id ASC
    ) AS rn
  FROM "Session"
) ranked
WHERE rn = 1;

-- Step 2: Merge all nullable fields from duplicates into the kept row
-- Use the latest non-null value for each field; ended_at = GREATEST of all non-null
WITH duplicates AS (
  SELECT 
    s.project_id,
    s.session_id,
    s.app,
    -- Latest non-null values (last_value ignores nulls)
    (array_agg(s.user_id ORDER BY s.started_at, s.id) FILTER (WHERE s.user_id IS NOT NULL))[1] AS latest_user_id,
    (array_agg(s.user_email ORDER BY s.started_at, s.id) FILTER (WHERE s.user_email IS NOT NULL))[1] AS latest_user_email,
    (array_agg(s.anonymous_id ORDER BY s.started_at, s.id) FILTER (WHERE s.anonymous_id IS NOT NULL))[1] AS latest_anonymous_id,
    (array_agg(s.country ORDER BY s.started_at, s.id) FILTER (WHERE s.country IS NOT NULL))[1] AS latest_country,
    (array_agg(s.device_browser ORDER BY s.started_at, s.id) FILTER (WHERE s.device_browser IS NOT NULL))[1] AS latest_device_browser,
    (array_agg(s.device_os ORDER BY s.started_at, s.id) FILTER (WHERE s.device_os IS NOT NULL))[1] AS latest_device_os,
    (array_agg(s.sdk_version ORDER BY s.started_at, s.id) FILTER (WHERE s.sdk_version IS NOT NULL))[1] AS latest_sdk_version,
    (array_agg(s.platform ORDER BY s.started_at, s.id) FILTER (WHERE s.platform IS NOT NULL))[1] AS latest_platform,
    (array_agg(s.environment ORDER BY s.started_at, s.id) FILTER (WHERE s.environment IS NOT NULL))[1] AS latest_environment,
    (array_agg(s.release ORDER BY s.started_at, s.id) FILTER (WHERE s.release IS NOT NULL))[1] AS latest_release,
    -- ended_at: GREATEST of all non-null values
    MAX(s.ended_at) AS latest_ended_at
  FROM "Session" s
  WHERE EXISTS (
    -- Only process groups with duplicates
    SELECT 1 
    FROM "Session" s2 
    WHERE s2.project_id = s.project_id 
      AND s2.session_id = s.session_id 
      AND s2.app = s.app 
      AND s2.id != s.id
  )
  GROUP BY s.project_id, s.session_id, s.app
),
kept_rows AS (
  SELECT s.id, d.*
  FROM "Session" s
  INNER JOIN duplicates d 
    ON s.project_id = d.project_id 
    AND s.session_id = d.session_id
    AND s.app = d.app
  WHERE s.id IN (SELECT id FROM sessions_to_keep)
)
UPDATE "Session" s
SET 
  user_id = COALESCE(s.user_id, k.latest_user_id),
  user_email = COALESCE(s.user_email, k.latest_user_email),
  anonymous_id = COALESCE(s.anonymous_id, k.latest_anonymous_id),
  country = COALESCE(s.country, k.latest_country),
  device_browser = COALESCE(s.device_browser, k.latest_device_browser),
  device_os = COALESCE(s.device_os, k.latest_device_os),
  sdk_version = COALESCE(s.sdk_version, k.latest_sdk_version),
  platform = COALESCE(s.platform, k.latest_platform),
  environment = COALESCE(s.environment, k.latest_environment),
  release = COALESCE(s.release, k.latest_release),
  ended_at = COALESCE(s.ended_at, k.latest_ended_at)
FROM kept_rows k
WHERE s.id = k.id;

-- Step 3: Delete all duplicate sessions except the kept ones
DELETE FROM "Session"
WHERE id NOT IN (SELECT id FROM sessions_to_keep)
  AND (project_id, session_id, app) IN (
    SELECT project_id, session_id, app
    FROM "Session"
    GROUP BY project_id, session_id, app
    HAVING COUNT(*) > 1
  );

-- Step 4: Add unique constraint on (project_id, session_id, app)
CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app");

COMMIT;
