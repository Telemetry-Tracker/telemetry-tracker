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
CREATE TABLE "UserReferral" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "rewardful_referral_id" TEXT,
    "via_token" TEXT,
    "source" TEXT NOT NULL DEFAULT 'link',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributed_organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "rewardful_affiliate_id" TEXT NOT NULL,
    "link_token" TEXT,
    "email_normalized" TEXT,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationReferral" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "affiliate_id" TEXT,
    "rewardful_referral_id" TEXT,
    "via_token" TEXT,
    "source" TEXT NOT NULL,
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
CREATE INDEX "WebhookEvent_provider_status_locked_at_idx" ON "WebhookEvent"("provider", "status", "locked_at");

-- CreateIndex
CREATE UNIQUE INDEX "UserReferral_user_id_key" ON "UserReferral"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserReferral_attributed_organization_id_key" ON "UserReferral"("attributed_organization_id");

-- CreateIndex
CREATE INDEX "UserReferral_affiliate_id_idx" ON "UserReferral"("affiliate_id");

-- CreateIndex
CREATE INDEX "UserReferral_rewardful_referral_id_idx" ON "UserReferral"("rewardful_referral_id");

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
CREATE INDEX "OrganizationReferral_needs_attention_idx" ON "OrganizationReferral"("needs_attention");

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
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
