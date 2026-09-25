-- Existing keys keep upload access so current CI does not break.
-- New keys default to ingest-only until explicitly opted in.
ALTER TABLE "ApiKey" ADD COLUMN "source_map_upload" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ApiKey" SET "source_map_upload" = true;
