-- Forward-migrate Rewardful-shaped tables from 20261004180000 (applied in production
-- on 1.17.27 via migrateDeployBeforeListen) to the native TT affiliate schema.
-- Production tables are expected empty (AFFILIATES_ENABLED never ON; no Rewardful use).
-- Sequence: add nullable native columns → backfill any rows → drop Rewardful-only
-- columns/constraints → enforce NOT NULL / unique indexes.

-- Affiliate: native public code + founder fields; drop rewardful_affiliate_id / link_token
ALTER TABLE "Affiliate" ADD COLUMN "code" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "name" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "email" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "commission_rate_bps" INTEGER NOT NULL DEFAULT 3000;

UPDATE "Affiliate"
SET
  "code" = COALESCE(NULLIF(lower("link_token"), ''), lower("rewardful_affiliate_id")),
  "name" = COALESCE(NULLIF("email_normalized", ''), "rewardful_affiliate_id"),
  "email" = COALESCE("email", "email_normalized")
WHERE "code" IS NULL OR "name" IS NULL;

UPDATE "Affiliate" AS a
SET "code" = a."code" || '-' || left(replace(a."id", '-', ''), 8)
WHERE EXISTS (
  SELECT 1 FROM "Affiliate" AS b
  WHERE b."code" = a."code" AND b."id" <> a."id"
);

ALTER TABLE "Affiliate" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Affiliate" ALTER COLUMN "name" SET NOT NULL;
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

DROP INDEX "Affiliate_rewardful_affiliate_id_key";
DROP INDEX "Affiliate_link_token_idx";
ALTER TABLE "Affiliate" DROP COLUMN "rewardful_affiliate_id";
ALTER TABLE "Affiliate" DROP COLUMN "link_token";

-- UserReferral: referral_code replaces rewardful_referral_id / via_token
ALTER TABLE "UserReferral" ADD COLUMN "referral_code" TEXT;
UPDATE "UserReferral"
SET "referral_code" = "via_token"
WHERE "referral_code" IS NULL AND "via_token" IS NOT NULL;
DROP INDEX "UserReferral_rewardful_referral_id_idx";
ALTER TABLE "UserReferral" DROP COLUMN "rewardful_referral_id";
ALTER TABLE "UserReferral" DROP COLUMN "via_token";
CREATE INDEX "UserReferral_referral_code_idx" ON "UserReferral"("referral_code");

-- OrganizationReferral: same column rename
ALTER TABLE "OrganizationReferral" ADD COLUMN "referral_code" TEXT;
UPDATE "OrganizationReferral"
SET "referral_code" = "via_token"
WHERE "referral_code" IS NULL AND "via_token" IS NOT NULL;
DROP INDEX "OrganizationReferral_rewardful_referral_id_idx";
ALTER TABLE "OrganizationReferral" DROP COLUMN "rewardful_referral_id";
ALTER TABLE "OrganizationReferral" DROP COLUMN "via_token";
CREATE INDEX "OrganizationReferral_referral_code_idx" ON "OrganizationReferral"("referral_code");

-- AffiliatePayout (new)
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "reference_note" TEXT,
    "created_by" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AffiliatePayout_idempotency_key_key" ON "AffiliatePayout"("idempotency_key");
CREATE INDEX "AffiliatePayout_affiliate_id_paid_at_idx" ON "AffiliatePayout"("affiliate_id", "paid_at");

ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AffiliateCommission: native ledger columns; drop rewardful_commission_id / due_at
ALTER TABLE "AffiliateCommission" ADD COLUMN "stripe_invoice_id" TEXT;
ALTER TABLE "AffiliateCommission" ADD COLUMN "stripe_payment_intent_id" TEXT;
ALTER TABLE "AffiliateCommission" ADD COLUMN "eligible_base_cents" INTEGER;
ALTER TABLE "AffiliateCommission" ADD COLUMN "remaining_cents" INTEGER;
ALTER TABLE "AffiliateCommission" ADD COLUMN "invoice_paid_at" TIMESTAMP(3);
ALTER TABLE "AffiliateCommission" ADD COLUMN "payable_at" TIMESTAMP(3);
ALTER TABLE "AffiliateCommission" ADD COLUMN "payout_id" TEXT;
ALTER TABLE "AffiliateCommission" ADD COLUMN "dispute_status" TEXT;

DELETE FROM "AffiliateCommission" WHERE "affiliate_id" IS NULL OR "organization_id" IS NULL;

UPDATE "AffiliateCommission"
SET
  "stripe_invoice_id" = COALESCE("stripe_invoice_id", "rewardful_commission_id"),
  "eligible_base_cents" = COALESCE("eligible_base_cents", "amount_cents"),
  "remaining_cents" = COALESCE("remaining_cents", "amount_cents"),
  "invoice_paid_at" = COALESCE("invoice_paid_at", "created_at"),
  "payable_at" = COALESCE("payable_at", "due_at", "created_at");

ALTER TABLE "AffiliateCommission" DROP CONSTRAINT "AffiliateCommission_affiliate_id_fkey";
ALTER TABLE "AffiliateCommission" DROP CONSTRAINT "AffiliateCommission_organization_id_fkey";

DROP INDEX "AffiliateCommission_rewardful_commission_id_key";
DROP INDEX "AffiliateCommission_state_due_at_idx";
ALTER TABLE "AffiliateCommission" DROP COLUMN "rewardful_commission_id";
ALTER TABLE "AffiliateCommission" DROP COLUMN "due_at";

ALTER TABLE "AffiliateCommission" ALTER COLUMN "affiliate_id" SET NOT NULL;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "stripe_invoice_id" SET NOT NULL;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "eligible_base_cents" SET NOT NULL;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "remaining_cents" SET NOT NULL;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "invoice_paid_at" SET NOT NULL;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "payable_at" SET NOT NULL;

CREATE UNIQUE INDEX "AffiliateCommission_stripe_invoice_id_key" ON "AffiliateCommission"("stripe_invoice_id");
CREATE INDEX "AffiliateCommission_stripe_payment_intent_id_idx" ON "AffiliateCommission"("stripe_payment_intent_id");
CREATE INDEX "AffiliateCommission_state_payable_at_idx" ON "AffiliateCommission"("state", "payable_at");
CREATE INDEX "AffiliateCommission_payout_id_idx" ON "AffiliateCommission"("payout_id");

ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "AffiliatePayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AffiliateAdjustment (new)
CREATE TABLE "AffiliateAdjustment" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "commission_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "stripe_refund_id" TEXT,
    "stripe_invoice_id" TEXT,
    "payout_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AffiliateAdjustment_affiliate_id_idx" ON "AffiliateAdjustment"("affiliate_id");
CREATE INDEX "AffiliateAdjustment_commission_id_idx" ON "AffiliateAdjustment"("commission_id");
CREATE INDEX "AffiliateAdjustment_payout_id_idx" ON "AffiliateAdjustment"("payout_id");
CREATE INDEX "AffiliateAdjustment_stripe_invoice_id_idx" ON "AffiliateAdjustment"("stripe_invoice_id");

ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "AffiliateCommission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "AffiliatePayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
