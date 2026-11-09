-- Opaque session ids for list/revoke APIs (bearer secret stays on "id").
ALTER TABLE "UserSession" ADD COLUMN "public_id" TEXT;

UPDATE "UserSession"
SET "public_id" = gen_random_uuid()::text
WHERE "public_id" IS NULL;

ALTER TABLE "UserSession" ALTER COLUMN "public_id" SET NOT NULL;
ALTER TABLE "UserSession" ALTER COLUMN "public_id" SET DEFAULT (gen_random_uuid()::text);

CREATE UNIQUE INDEX "UserSession_public_id_key" ON "UserSession"("public_id");
