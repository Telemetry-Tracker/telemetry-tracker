-- CreateTable
CREATE TABLE "ProjectApp" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "framework" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "first_event_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ProjectApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectApp_project_id_deleted_at_idx" ON "ProjectApp"("project_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApp_project_id_name_key" ON "ProjectApp"("project_id", "name");

-- AddForeignKey
ALTER TABLE "ProjectApp" ADD CONSTRAINT "ProjectApp_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill registered apps from existing telemetry (no fake events).
INSERT INTO "ProjectApp" ("id", "project_id", "name", "framework", "created_at", "updated_at", "first_event_at", "deleted_at")
SELECT
  gen_random_uuid()::text,
  t.project_id,
  t.app,
  NULL,
  COALESCE(t.first_seen, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  t.first_seen,
  NULL
FROM (
  SELECT project_id, TRIM(app) AS app, MIN(seen_at) AS first_seen
  FROM (
    SELECT project_id, app, MIN(created_at) AS seen_at FROM "Event" GROUP BY project_id, app
    UNION ALL
    SELECT project_id, app, MIN(started_at) AS seen_at FROM "Session" GROUP BY project_id, app
    UNION ALL
    SELECT project_id, app, MIN(first_seen) AS seen_at FROM "ErrorGroup" GROUP BY project_id, app
  ) u
  WHERE TRIM(app) <> ''
  GROUP BY project_id, TRIM(app)
) t
ON CONFLICT ("project_id", "name") DO NOTHING;
