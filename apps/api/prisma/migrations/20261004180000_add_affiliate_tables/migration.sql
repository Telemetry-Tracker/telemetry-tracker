-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('UNRESOLVED', 'ACTIVE', 'EXPIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "claim_token" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "email_normalized" TEXT,
    "state" TEXT NOT NULL,
    "commission_rate_bps" INTEGER NOT NULL DEFAULT 3000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReferral" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "referral_code" TEXT,
    "source" TEXT NOT NULL DEFAULT 'link',
    "status" "ReferralStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributed_organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationReferral" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "referral_code" TEXT,
    "source" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "first_seen_at" TIMESTAMP(3),
    "attributed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "attention_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL,
    "stripe_charge_id" TEXT,
    "eligible_base_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "remaining_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "invoice_paid_at" TIMESTAMP(3) NOT NULL,
    "payable_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "payout_id" TEXT,
    "dispute_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_event_id_key" ON "WebhookEvent"("provider", "event_id");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_received_at_idx" ON "WebhookEvent"("provider", "received_at");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_locked_at_idx" ON "WebhookEvent"("provider", "status", "locked_at");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE INDEX "Affiliate_email_normalized_idx" ON "Affiliate"("email_normalized");

-- CreateIndex
CREATE INDEX "Affiliate_state_idx" ON "Affiliate"("state");

-- CreateIndex
CREATE UNIQUE INDEX "UserReferral_user_id_key" ON "UserReferral"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserReferral_attributed_organization_id_key" ON "UserReferral"("attributed_organization_id");

-- CreateIndex
CREATE INDEX "UserReferral_affiliate_id_idx" ON "UserReferral"("affiliate_id");

-- CreateIndex
CREATE INDEX "UserReferral_referral_code_idx" ON "UserReferral"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationReferral_organization_id_key" ON "OrganizationReferral"("organization_id");

-- CreateIndex
CREATE INDEX "OrganizationReferral_affiliate_id_idx" ON "OrganizationReferral"("affiliate_id");

-- CreateIndex
CREATE INDEX "OrganizationReferral_referral_code_idx" ON "OrganizationReferral"("referral_code");

-- CreateIndex
CREATE INDEX "OrganizationReferral_source_idx" ON "OrganizationReferral"("source");

-- CreateIndex
CREATE INDEX "OrganizationReferral_attributed_at_idx" ON "OrganizationReferral"("attributed_at");

-- CreateIndex
CREATE INDEX "OrganizationReferral_needs_attention_idx" ON "OrganizationReferral"("needs_attention");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliatePayout_idempotency_key_key" ON "AffiliatePayout"("idempotency_key");

-- CreateIndex
CREATE INDEX "AffiliatePayout_affiliate_id_paid_at_idx" ON "AffiliatePayout"("affiliate_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_stripe_invoice_id_key" ON "AffiliateCommission"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliate_id_state_idx" ON "AffiliateCommission"("affiliate_id", "state");

-- CreateIndex
CREATE INDEX "AffiliateCommission_organization_id_idx" ON "AffiliateCommission"("organization_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_stripe_charge_id_idx" ON "AffiliateCommission"("stripe_charge_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_state_payable_at_idx" ON "AffiliateCommission"("state", "payable_at");

-- CreateIndex
CREATE INDEX "AffiliateCommission_payout_id_idx" ON "AffiliateCommission"("payout_id");

-- CreateIndex
CREATE INDEX "AffiliateAdjustment_affiliate_id_idx" ON "AffiliateAdjustment"("affiliate_id");

-- CreateIndex
CREATE INDEX "AffiliateAdjustment_commission_id_idx" ON "AffiliateAdjustment"("commission_id");

-- CreateIndex
CREATE INDEX "AffiliateAdjustment_payout_id_idx" ON "AffiliateAdjustment"("payout_id");

-- CreateIndex
CREATE INDEX "AffiliateAdjustment_stripe_invoice_id_idx" ON "AffiliateAdjustment"("stripe_invoice_id");

-- AddForeignKey
ALTER TABLE "UserReferral" ADD CONSTRAINT "UserReferral_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReferral" ADD CONSTRAINT "UserReferral_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReferral" ADD CONSTRAINT "UserReferral_attributed_organization_id_fkey" FOREIGN KEY ("attributed_organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationReferral" ADD CONSTRAINT "OrganizationReferral_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationReferral" ADD CONSTRAINT "OrganizationReferral_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "AffiliatePayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "AffiliateCommission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateAdjustment" ADD CONSTRAINT "AffiliateAdjustment_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "AffiliatePayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
