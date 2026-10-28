-- Add identity_updated_at column to track when user_id/user_email were last set.
-- Used to prevent stale SDK requests from overwriting fresher identity data.

ALTER TABLE "Session" ADD COLUMN "identity_updated_at" TIMESTAMP(3);

-- Backfill: set identity_updated_at = started_at for existing sessions with user_id
-- (assume identity was set at session start if user_id exists)
UPDATE "Session"
SET "identity_updated_at" = "started_at"
WHERE "user_id" IS NOT NULL AND "identity_updated_at" IS NULL;
