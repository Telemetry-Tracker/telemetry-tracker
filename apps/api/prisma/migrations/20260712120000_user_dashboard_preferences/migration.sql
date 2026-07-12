-- Per-user dashboard defaults and privacy preferences (JSON).
ALTER TABLE "User" ADD COLUMN "dashboard_preferences" JSONB;
