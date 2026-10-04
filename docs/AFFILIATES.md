# Affiliate Program (Rewardful Integration)

## Overview

The affiliate program allows partners to earn commissions for referring new customers. It's powered by [Rewardful](https://www.getrewardful.com/) and integrates with Stripe billing.

**Feature flag:** `AFFILIATES_ENABLED` (default: `false`)

When the feature is disabled:
- Registration accepts but ignores referral parameters
- No Rewardful script loads in the dashboard
- No Stripe Customer metadata is written
- The Rewardful webhook route returns 404
- Existing billing flows remain byte-for-byte identical

## Environment Variables

### API (`apps/api/.env`)

```bash
# Master switch (requires Stripe to be configured)
AFFILIATES_ENABLED=true

# Rewardful API credentials (from Rewardful dashboard)
REWARDFUL_WEBHOOK_SECRET=whsec_...

# Founder notification emails for disputes (comma-separated)
AFFILIATE_ADMIN_EMAILS=founder@example.com,admin@example.com
```

### Dashboard (`apps/dashboard/.env.local`)

```bash
# Client-side feature flag
NEXT_PUBLIC_AFFILIATES_ENABLED=true

# Rewardful public API key (safe for client-side)
NEXT_PUBLIC_REWARDFUL_API_KEY=pk_...
```

## Attribution Flow

### 1. Referral Capture (Registration)

When a user signs up:

1. Dashboard reads `window.Rewardful.referral` (UUID) or `?via=` query param (affiliate link token)
2. Both values are sent to `POST /auth/register` as `rewardfulReferralId` and `viaToken`
3. API validates formats:
   - UUID: `/^[0-9a-f-]{36}$/i`
   - via token: `/^[A-Za-z0-9_-]{1,64}$/`
4. Creates immutable `UserReferral` row with:
   - `affiliate_id`: resolved affiliate (if known), else `null`
   - `rewardful_referral_id`: validated UUID
   - `via_token`: validated token
   - `captured_at`: signup timestamp

**Self-referral check:** If the user's normalized email matches the affiliate's email, the referral is rejected.

**Script-blocked fallback:** If Rewardful script fails to load but `?via=` is present, the via token is stored and used for attribution.

**Conflict handling:** If both UUID and via token are present and point to different affiliates, the UUID wins (last-click priority), and `needs_attention` is flagged.

### 2. Organization Attribution (First Org Creation)

When a referred user creates their **first organization as OWNER**:

1. API checks if user has a `UserReferral`
2. Verifies:
   - Not expired (≤55 days since capture)
   - Not self-referral (checks again in case affiliate was resolved after signup)
   - Only first org as OWNER (later orgs are not attributed)
3. Creates `OrganizationReferral` row
4. Creates Stripe `Customer` with metadata:
   ```json
   {
     "tt_org_id": "org-uuid",
     "tt_affiliate_id": "affiliate-uuid",
     "referral": "rewardful-uuid-or-via-token"
   }
   ```
   This triggers a **lead** in Rewardful.

**55-day rule:** If the org is created >55 days after signup, `OrganizationReferral` is created with `needs_attention = true` and `attention_reason = 'referral_expired_55_days'`. No Stripe Customer metadata is written.

**Invitees:** Users invited to existing orgs are never attributed (they don't create the org as OWNER).

### 3. Checkout (Free → Paid Conversion)

When an organization upgrades to a paid plan:

1. If a `Customer` already exists (from org attribution), checkout reuses it
2. If not (non-referred org or lazy creation), a new Customer is created **without** affiliate metadata
3. On successful checkout, Rewardful sees the charge on the Customer with `metadata.referral` and creates a **conversion**

**Months-later conversion:** A Free account that upgrades months after signup still converts because the Customer metadata was set at org creation.

**Metadata update at checkout:** If the Customer exists but lacks `metadata.referral`, and the org has a valid `OrganizationReferral` (not expired/rejected), the metadata is added. Failures are logged but never fail checkout.

## Webhooks

### Rewardful Webhook (`POST /webhooks/rewardful`)

Mirrors affiliate data from Rewardful for self-referral checks and reconciliation. **Never moves money.**

**Signature verification:** HMAC-SHA256 with `REWARDFUL_WEBHOOK_SECRET`. Rejects unless header matches `/^[0-9a-f]{64}$/i` before decoding. Uses `timingSafeEqual` for constant-time comparison.

**Deduplication:** Atomic claim-based dedupe via `WebhookEvent` table. Concurrent deliveries are safe.

**Events mirrored:**
- `affiliate.created`, `affiliate.updated`: upserts `Affiliate` table
- `referral.created`, `referral.converted`: completes unresolved `UserReferral` / `OrganizationReferral` with `affiliate_id`
- `commission.created`, `commission.updated`, `commission.paid`, `commission.voided`: mirrors to `AffiliateCommission`
- `payout.created`, `payout.paid`: audit log only

**Self-referral check on completion:** When webhook completes an unresolved referral, it checks normalized emails. Self-referrals are rejected by setting `needs_attention = true` and `attention_reason = 'rejected_self_referral'`.

### Stripe Webhook (Dispute Alert)

**Event:** `charge.dispute.created`

When a dispute is created on a charge for a referred organization:

1. Finds org via Stripe `customer_id`
2. Checks if org has an `OrganizationReferral`
3. Logs `OrganizationAuditEvent` with action `affiliate.dispute.created`
4. Emails each address in `AFFILIATE_ADMIN_EMAILS` with:
   - Organization name (HTML-escaped)
   - Dispute ID, charge ID, amount, reason
   - `[TEST MODE]` prefix in subject if `livemode = false`
   - Livemode field in body

**Deduplication:** Handled by `WebhookEvent` claim. Retries don't duplicate audit rows or emails.

**Error handling:** Email failures are logged but never fail the webhook.

## Immutability

**`affiliate_id` on `UserReferral` and `OrganizationReferral`:**
- May only change from `null` to a value, **once**
- All `updateMany` operations include `WHERE affiliate_id IS NULL`
- No update paths allow changing non-null `affiliate_id`

**`metadata.referral` on Stripe Customer:**
- Set at org creation (if attributed) or checkout (backfill)
- Once set, never changed
- Never set for expired or rejected referrals

## Deferred Features

Not included in V1 (implement later):

1. **Public application form** for new affiliates
2. **IBAN storage** and Wise batch payments (payout automation)
3. **Self-billing PDFs** for EU contractors
4. **SDK event gate** for free-tier analytics (require referral to unlock)
5. **Reconciliation job** to compare TT commissions vs Rewardful payouts
6. **Click analytics** (track affiliate link visits before signup)
7. **Fraud detection engine** (pattern-based self-referral detection)

## Self-Hosting Notes

Self-hosted instances without Stripe configuration will never enable the feature (no `STRIPE_SECRET_KEY`). The affiliate program is designed for SaaS deployments only.

## Testing

Run integration tests with:

```bash
# Flag OFF (must match develop behavior)
RUN_DB_INTEGRATION_TESTS=true pnpm test

# Flag ON
AFFILIATES_ENABLED=true RUN_DB_INTEGRATION_TESTS=true pnpm test
```

Dashboard consent tests:

```bash
cd apps/dashboard
pnpm test
```

## Monitoring

Key metrics to track:
- `OrganizationReferral.needs_attention = true` (manual review required)
- `WebhookEvent.status = 'failed'` (Rewardful webhook failures)
- `OrganizationAuditEvent.action = 'affiliate.dispute.created'` (dispute alerts)
- Stripe Customer metadata coverage for referred orgs
