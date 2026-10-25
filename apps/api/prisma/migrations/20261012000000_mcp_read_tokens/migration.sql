CREATE TABLE "McpReadToken" (
 "id" TEXT NOT NULL PRIMARY KEY, "public_id" TEXT NOT NULL, "secret_hash" TEXT NOT NULL,
 "name" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "created_by_user_id" TEXT NOT NULL,
 "project_ids" TEXT[] NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expires_at" TIMESTAMP(3) NOT NULL, "revoked_at" TIMESTAMP(3), "expiry_logged_at" TIMESTAMP(3),
 "last_used_at" TIMESTAMP(3), "usage_count" INTEGER NOT NULL DEFAULT 0, "last_tool" TEXT,
 CONSTRAINT "McpReadToken_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "McpReadToken_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "McpReadToken_public_id_key" ON "McpReadToken"("public_id");
CREATE INDEX "McpReadToken_organization_id_idx" ON "McpReadToken"("organization_id");
CREATE TABLE "McpRateBucket" ("key" TEXT NOT NULL PRIMARY KEY, "window_start" TIMESTAMP(3) NOT NULL, "count" INTEGER NOT NULL);
