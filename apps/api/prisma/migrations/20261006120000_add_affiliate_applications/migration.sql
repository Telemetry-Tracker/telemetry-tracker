-- Public affiliate program applications (/affiliates form). Additive only: one new table,
-- its indexes, and a nullable FK to "Affiliate". No existing table or column is changed.
-- Dedupe: "pending_email_key" equals "email_normalized" while status = 'pending' and is NULL
-- otherwise, so the unique index allows at most one pending application per email.

-- CreateTable
CREATE TABLE "AffiliateApplication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "pending_email_key" TEXT,
    "website_url" TEXT NOT NULL,
    "promotion_plan" TEXT NOT NULL,
    "terms_version" TEXT NOT NULL,
    "terms_accepted_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "affiliate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateApplication_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateApplication_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateApplication_pending_email_key_key" ON "AffiliateApplication"("pending_email_key");

-- CreateIndex
CREATE INDEX "AffiliateApplication_status_created_at_idx" ON "AffiliateApplication"("status", "created_at");

-- CreateIndex
CREATE INDEX "AffiliateApplication_email_normalized_idx" ON "AffiliateApplication"("email_normalized");

-- CreateIndex
CREATE INDEX "AffiliateApplication_affiliate_id_idx" ON "AffiliateApplication"("affiliate_id");

-- AddForeignKey
ALTER TABLE "AffiliateApplication" ADD CONSTRAINT "AffiliateApplication_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
