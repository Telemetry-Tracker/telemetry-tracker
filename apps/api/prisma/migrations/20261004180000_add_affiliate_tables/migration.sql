-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "rewardful_affiliate_id" TEXT NOT NULL,
    "link_token" TEXT,
    "email_normalized" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationReferral" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "rewardful_referral_id" TEXT,
    "via_token" TEXT,
    "source" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3),
    "attributed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "rewardful_commission_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "organization_id" TEXT,
    "stripe_charge_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_event_id_key" ON "WebhookEvent"("provider", "event_id");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_received_at_idx" ON "WebhookEvent"("provider", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_rewardful_affiliate_id_key" ON "Affiliate"("rewardful_affiliate_id");

-- CreateIndex
CREATE INDEX "Affiliate_link_token_idx" ON "Affiliate"("link_token");

-- CreateIndex
CREATE INDEX "Affiliate_email_normalized_idx" ON "Affiliate"("email_normalized");

-- CreateIndex
CREATE INDEX "Affiliate_state_idx" ON "Affiliate"("state");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationReferral_organization_id_key" ON "OrganizationReferral"("organization_id");

-- CreateIndex
CREATE INDEX "OrganizationReferral_affiliate_id_idx" ON "OrganizationReferral"("affiliate_id");

-- CreateIndex
CREATE INDEX "OrganizationReferral_rewardful_referral_id_idx" ON "OrganizationReferral"("rewardful_referral_id");

-- CreateIndex
CREATE INDEX "OrganizationReferral_source_idx" ON "OrganizationReferral"("source");

-- CreateIndex
CREATE INDEX "OrganizationReferral_attributed_at_idx" ON "OrganizationReferral"("attributed_at");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_rewardful_commission_id_key" ON "AffiliateCommission"("rewardful_commission_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliate_id_state_idx" ON "AffiliateCommission"("affiliate_id", "state");

-- CreateIndex
CREATE INDEX "AffiliateCommission_organization_id_idx" ON "AffiliateCommission"("organization_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_stripe_charge_id_idx" ON "AffiliateCommission"("stripe_charge_id");

-- CreateIndex
CREATE INDEX "AffiliateCommission_state_due_at_idx" ON "AffiliateCommission"("state", "due_at");

-- AddForeignKey
ALTER TABLE "OrganizationReferral" ADD CONSTRAINT "OrganizationReferral_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationReferral" ADD CONSTRAINT "OrganizationReferral_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
