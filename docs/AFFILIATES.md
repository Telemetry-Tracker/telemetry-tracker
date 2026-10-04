# Affiliate Program Integration (Rewardful)

## Overview

Telemetry Tracker integrates with [Rewardful](https://www.getrewardful.com/) to track and reward affiliates who refer new customers. When the feature flag is **OFF**, the system behaves identically to develop (no affiliate tracking).

## Feature Flag

```bash
AFFILIATES_ENABLED=true
```

When `false` or unset:
- Registration ignores all referral fields (`rewardfulReferralId`, `viaToken`)
- `/webhooks/rewardful` returns 404
- Checkout sessions have no `tt_*` metadata
- All affiliate tables remain empty

## Referral Capture

### Registration Route

**Endpoint**: `/api/auth/register`

**Referral Fields** (optional):
```json
{
  "email": "user@example.com",
  "password": "...",
  "rewardfulReferralId": "00000000-0000-4000-8000-000000000001",
  "viaToken": "affiliate-link-token"
}
```

**UUID Format**: RFC 4122 UUID v4 (regex: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

**Via Token Format**: alphanumeric + hyphens/underscores, 3-100 characters

### Last-Click Attribution

When both `rewardfulReferralId` (UUID) and `viaToken` are present:
- **UUID preferred** (last-click wins)
- Via token stored as fallback for audit trail
- No conflict detection

### Script-Blocked Fallback

When Rewardful's third-party script is blocked:
1. Affiliate link redirects to `/register?via=TOKEN`
2. Client sends `via` as first-party URL param → backend as `viaToken`
3. No Rewardful cookie required

## Referral Status Lifecycle

```typescript
enum ReferralStatus {
  UNRESOLVED  // Affiliate not yet resolved (UUID without webhook)
  ACTIVE      // Affiliate resolved, within 55-day window
  EXPIRED     // Outside 55-day attribution window
  REJECTED    // Self-referral or policy violation
}
```

Status is set on both `UserReferral` and `OrganizationReferral` models.

### 55-Day Attribution Window

Measured from `UserReferral.captured_at` (registration time), **never** from webhook arrival:
- A referral captured at signup is **never** expired by a late `referral.converted` webhook
- Window checks use Rewardful referral timestamps when available

### Self-Referral Protection

Rejected when:
- User email matches affiliate email (after normalization)
- `gmail.com` ↔ `googlemail.com` treated as equivalent

When affiliate email is unknown:
- Expiry/rejection checks still run
- Status set to `UNRESOLVED` or `ACTIVE`
- Flagged `needs_attention` for manual verification

## Organization Attribution

### First-Org-Only Rule

Only the **first organization** created by a referred user receives:
- Stripe Customer with `tt_*` metadata
- OrganizationReferral record

Subsequent orgs (including after deleting the first) are **not** attributed.

**Implementation**: `UserReferral.attributed_organization_id` (unique, nullable) is set atomically via `updateMany` with `WHERE attributed_organization_id IS NULL` guard.

## Stripe Checkout Metadata

### Active Attributions Only

Checkout session `metadata` includes `tt_*` fields **only** for:
- `UserReferral.status === "ACTIVE"`
- `UserReferral.attributed_organization_id === <this org>`

Expired/rejected referrals: no `tt_*` metadata.

### Metadata Example

```json
{
  "organization_id": "org_abc123",
  "tt_org_id": "org_abc123",
  "tt_affiliate_id": "aff_xyz789"
}
```

**Checkout Args**: Identical to develop for all users (no `allow_promotion_codes`), except `tt_*` metadata for referred orgs.

### Customer Reuse

For referred orgs upgrading from Free:
- Existing `stripe_customer_id` **reused**
- Metadata added to existing Customer (not recreated)
- Works even if referral captured 90+ days ago (no expiry on metadata)

## Commission Eligibility

Commissions apply to **all paid hosted plans**:
- ✅ Pro
- ✅ Business
- ❌ Self-hosted (never eligible)

## Stripe Webhook Handling

### Dispute Alerts

`charge.dispute.created` webhooks:
- **Test mode** (`livemode: false`): log only, **no email**
- **Live mode** (`livemode: true`): send email alert

### Deduplication

All Stripe webhooks use atomic claim-based deduplication:
- `WebhookEvent` table with `claim_token` (16-byte hex)
- Concurrent deliveries: exactly one processes
- Stale processing rows (10+ minutes): reclaimed
- Ownership guard: only token owner can mark processed/failed

**Timezone Safety**: All `WebhookEvent` timestamps use `TIMESTAMPTZ(3)` for correct comparisons regardless of database session timezone.

## Rewardful Webhook Handling

**Endpoint**: `/webhooks/rewardful`

**Signature Verification**: `X-Rewardful-Signature` header (HMAC-SHA256)

### Supported Events

- `referral.lead`: Tracks click (future use)
- `referral.created`: Pre-conversion tracking
- `referral.converted`: Completes unresolved referrals, links affiliate
- `commission.created`: Records commission due
- `commission.voided`: Marks commission voided

### Webhook Deduplication

Same atomic claim system as Stripe webhooks.

## Environment Variables

Required when `AFFILIATES_ENABLED=true`:
```bash
AFFILIATES_ENABLED=true
REWARDFUL_WEBHOOK_SECRET=whsec_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
TELEMETRY_ALLOW_REGISTRATION=true
```

## Database Schema

### Tables

- **WebhookEvent**: Deduplication (provider, event_id unique)
- **UserReferral**: User-level capture (user_id unique, status, attributed_organization_id unique nullable)
- **Affiliate**: Rewardful affiliate data (rewardful_affiliate_id unique)
- **OrganizationReferral**: Org-level attribution (organization_id unique, status)
- **AffiliateCommission**: Commission tracking (rewardful_commission_id unique)

### Key Constraints

- `UserReferral.user_id` → `User.id` (unique)
- `UserReferral.attributed_organization_id` → `Organization.id` (unique nullable)
- `OrganizationReferral.organization_id` → `Organization.id` (unique)

## Testing

### Run All Tests

```bash
# API tests (flag unset)
cd apps/api
RUN_DB_INTEGRATION_TESTS=true pnpm test

# API tests (flag ON)
AFFILIATES_ENABLED=true \
REWARDFUL_WEBHOOK_SECRET=test_secret \
STRIPE_SECRET_KEY=sk_test_fake \
TELEMETRY_ALLOW_REGISTRATION=true \
RUN_DB_INTEGRATION_TESTS=true \
pnpm test

# Dedupe tests with non-UTC timezone
TZ=Europe/Ljubljana \
RUN_DB_INTEGRATION_TESTS=true \
DATABASE_URL="postgresql://...?options=-c%20TimeZone=Europe/Ljubljana" \
pnpm test src/lib/webhook-dedupe.test.ts src/routes/stripe-webhook-dedupe.integration.test.ts
```

### Affiliate Test Files

```bash
# Protections (expired, rejected, dispute, dedupe, self-referral)
pnpm test affiliates-protections.integration

# Core flows (registration, attribution, flag-off, errors)
pnpm test affiliates.integration
```

All affiliate tests run in plain CI (no `AFFILIATES_ENABLED` gate) with env vars set in `beforeAll`.

## Migration

Single unreleased migration: `20261004180000_add_affiliate_tables`

Run: `npx prisma migrate dev`

## Known Limitations

- Rewardful API not called during registration (V1 scope)
- UUID-only referrals remain `UNRESOLVED` until `referral.converted` webhook
- Commission calculation handled entirely by Rewardful

## Support

For questions or issues, contact the platform team or see `docs/DEVELOPMENT.md`.
