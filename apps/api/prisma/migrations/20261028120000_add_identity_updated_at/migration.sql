-- Add identity_updated_at column to track when user_id/user_email were last set.
-- Used to prevent stale SDK requests from overwriting fresher identity data.
-- No backfill: existing sessions remain NULL (will use #887 behavior until re-identified).

ALTER TABLE "Session" ADD COLUMN "identity_updated_at" TIMESTAMP(3);
