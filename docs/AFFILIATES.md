# Affiliate Program Integration (Rewardful)

## Overview

Telemetry Tracker integrates with [Rewardful](https://www.getrewardful.com/) to track and reward affiliates who refer new customers. When the feature flag is **OFF**, the system behaves identically to develop (no affiliate tracking, no `WebhookEvent` rows for Stripe, identical checkout args except `tt_*` when a referred org is eligible).

## Feature Flag

Effective ON only when **both** are set:

```bash
AFFILIATES_ENABLED=true
STRIPE_SECRET_KEY=sk_...
```

`isAffiliateFeatureEnabled()` returns false if `AFFILIATES_ENABLED` is unset/not `"true"`, or if `STRIPE_SECRET_KEY` is missing.

When OFF:

- Registration ignores all referral fields (`rewardfulReferralId`, `viaToken`)
- `/webhooks/rewardful` is not registered (404)
- Checkout sessions have no `tt_*` metadata
- Stripe webhooks still upgrade the org, but **do not** write `WebhookEvent` rows
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

**UUID format** (`user-referral-capture.ts`): any RFC 4122-shaped UUID (all versions), case-insensitive:

```
/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

**Via token format**: `[A-Za-z0-9_-]{1,64}` (1–64 characters; alphanumeric, hyphen, underscore).

Invalid formats are ignored. At least one valid source is required to create a `UserReferral`.

### How UUID and via token are used

There is **no local UUID → affiliate resolution** and **no conflict detection**.

- The Rewardful referral UUID from the client is stored on `UserReferral.rewardful_referral_id`. It is written to Stripe Customer `metadata.referral` only when `!isPayoutHold` (self-referral-risk hold), not merely when `needs_attention` is clear. It stays `UNRESOLVED` until a `referral.converted` webhook maps it to an affiliate.
- The link token (`viaToken`) is the only value that resolves locally, via `Affiliate.link_token`.
- When both are present: the token may resolve `affiliate_id` immediately (`ACTIVE`); the UUID is still stored as-is for Rewardful / Customer metadata. A UUID that happens to equal some other affiliate's `rewardful_affiliate_id` is **not** treated as that affiliate.

### Script-blocked fallback

The register page reads a first-party `?via=` query param and sends it to the API as `viaToken`. There is no server-side `/register?via=` redirect.

## Referral Status Lifecycle

```typescript
enum ReferralStatus {
  UNRESOLVED  // UUID stored; affiliate not resolved yet
  ACTIVE      // Affiliate resolved (via token at signup, or referral.converted)
  EXPIRED     // Outside the 60-day window — decided at org creation
  REJECTED    // Self-referral
}
```

Status is stored on both `UserReferral` and `OrganizationReferral`.

### 60-day attribution window

Expiry is decided **once, at organization creation**, from `UserReferral.captured_at` (registration time). A late `referral.converted` webhook does **not** re-evaluate expiry. Source of truth: `REFERRAL_ATTRIBUTION_WINDOW_DAYS` in `organization-attribution.ts`. Comparison is `>` not `>=` (captured exactly 60 days ago is still in-window; day 61 is `EXPIRED`).

- Org created while still inside 60 days: status is `UNRESOLVED` or `ACTIVE`. A webhook arriving on day 70 can still complete an `UNRESOLVED` row to `ACTIVE`.
- Org created after the window: status is `EXPIRED`. Later `referral.converted` is a no-op for that row.

Webhook completion (`completeUnresolvedReferrals`) updates **only** rows with `status === "UNRESOLVED"` (and `affiliate_id: null`).

### Self-referral protection

Rejected when the user's email matches the affiliate email after normalization (`gmail.com` ↔ `googlemail.com` treated as equivalent).

When the affiliate has **no email**:

- At registration, a via-token hit with a missing affiliate email does **not** reject the capture and does **not** drop a valid Rewardful UUID. The `UserReferral` stays `UNRESOLVED` with `affiliate_id` unset so a later `referral.converted` can complete it.
- At org creation, a resolved affiliate with a missing email flags the org `needs_attention` (`affiliate_email_unknown`) and continues. Stripe Customer `metadata.referral` / `tt_*` are **not** written.
- A `referral.converted` webhook for an affiliate with no email can complete `UNRESOLVED` rows to `ACTIVE` and set `needs_attention` (`affiliate_email_unknown_cannot_verify_self_referral`).
- A `referral.converted` that supplies an affiliate email completes `UNRESOLVED` to `ACTIVE` and **clears** `needs_attention`. The next checkout may then backfill Customer `metadata.referral` and session `tt_*`.

**Payout hold vs `needs_attention`.** Stripe referral metadata is withheld only for a **payout hold** — self-referral-risk reasons (`affiliate_email_unknown*`, `no_owner_found_for_self_referral_check`, `rejected_self_referral`). Helper: `isPayoutHold(referral)`.

- Plain `UNRESOLVED` (UUID stored, affiliate not mapped yet) is **not** a payout hold. `needs_attention` stays false. Customer `metadata.referral` **is** written so Rewardful can convert.
- `customer_creation_failed` may set `needs_attention` as an internal flag but is **not** a payout hold. Checkout backfill still writes `metadata.referral` (and `tt_*` when ACTIVE).
- A payout hold blocks `metadata.referral` and `tt_*` until a `referral.converted` that supplies an affiliate email, or a founder **resolve** (below).

## Organization Attribution

### First-org-only rule

Only the **first organization** created by a referred user receives an `OrganizationReferral` and (when eligible) a Stripe Customer with referral metadata.

Subsequent orgs — including after archiving/deleting the first — are **not** attributed.

**Implementation**: `UserReferral.attributed_organization_id` (unique, nullable) is claimed atomically via `updateMany` with `WHERE attributed_organization_id IS NULL`.

## Stripe metadata gates

### Checkout session `tt_*`

`checkout.sessions.create` adds `tt_org_id` / `tt_affiliate_id` **only** when:

```
OrganizationReferral.status === "ACTIVE"
&& OrganizationReferral.affiliate_id
&& !isPayoutHold(OrganizationReferral)
```

Expired, rejected, unresolved, or payout-hold orgs get `organization_id` + `plan_tier` only (same shape as develop / flag OFF).

Checkout always reuses `Organization.stripe_customer_id` when present (`customers.create` is not called again).

### Customer `metadata.referral` (Rewardful payout token)

`isPayoutHold` **blocks** Stripe referral metadata (and thus Rewardful commission) until the hold is cleared. `UNRESOLVED` without a payout hold **does** get `metadata.referral` (the Rewardful UUID) — otherwise `referral.converted` never arrives.

**Org-creation Customer create** (when not expired and a UUID or resolved via token exists):

- Always create the Customer so billing works (`organization_id` only when on payout hold).
- Write `metadata.referral` when `(status === "ACTIVE" || status === "UNRESOLVED") && !isPayoutHold`.
- Write `tt_org_id` / `tt_affiliate_id` only when `status === "ACTIVE" && affiliate_id && !isPayoutHold`.

**Checkout backfill** (same predicates; also skips `EXPIRED` / `REJECTED`):

- `tt_*` → `ACTIVE && affiliate_id && !isPayoutHold`
- `metadata.referral` → `(ACTIVE || UNRESOLVED) && !isPayoutHold`
- Prefers the stored Rewardful UUID; via token is used only when there is no UUID and the affiliate is resolved.
- `customer_creation_failed` does **not** block backfill. If a later conversion or founder resolve clears a payout hold, the next checkout may write the missing fields.

### Founder resolve (payout hold)

`POST /api/meta/affiliates/organizations/:orgId/resolve-needs-attention`

Allowlist: session email must be in `AFFILIATE_ADMIN_EMAILS`. Feature flag must be ON.

Body: `{ "reason": "...", "affiliateId": "<optional confirmation>" }`

- Loads `OrganizationReferral` by org id.
- Refuses `REJECTED` / `EXPIRED` (409). Rejected referrals never get Rewardful metadata.
- Refuses if `affiliateId` is sent and would change the canonical `affiliate_id` (never rewritten after signup).
- Clears `needs_attention` / `attention_reason`; sets `ACTIVE` when `affiliate_id` is already known.
- `customers.update` on the **existing** `stripe_customer_id` only (never `customers.create`). If there is no Customer yet, the flag is still cleared and checkout backfill attaches metadata later.
- Writes `OrganizationAuditEvent` (`affiliate.needs_attention.resolve`) with actor, from→to status, reason, customer id, and Stripe outcome.
- Duplicate resolve is idempotent (same result, no extra Stripe write or audit when already clear).

## Commission eligibility

Commissions apply to **every paid hosted plan**:

- Pro
- Business

Self-hosted revenue is never commissioned. Rewardful remains the commission engine; TT mirrors commission/payout webhooks for audit.

## Stripe webhook handling

### Dispute alerts

`charge.dispute.created` (flag ON, referred org, `AFFILIATE_ADMIN_EMAILS` set):

- `livemode: false` — log only, **no email**
- `livemode: true` — send a transactional email to each admin address

### Deduplication

Stripe webhook dedupe (`WebhookEvent` claim/lock) runs **only when the affiliate flag is ON**. Flag OFF processes the event with no `WebhookEvent` row (identical to develop).

When the flag is ON:

- `WebhookEvent` with `claim_token` (16-byte hex)
- Concurrent deliveries: exactly one processes (`200` or `409`)
- Stale processing rows (10+ minutes) can be reclaimed
- Ownership guard: only the claim-token owner can mark processed/failed

All `WebhookEvent` timestamps use `TIMESTAMPTZ(3)`.

## Rewardful webhook handling

**Endpoint**: `/webhooks/rewardful` (registered only when the flag is ON **and** `REWARDFUL_WEBHOOK_SECRET` is set)

**Signature**: `X-Rewardful-Signature` (hex HMAC-SHA256 of the raw body)

### Handled events

- `affiliate.created` / `affiliate.updated` — upsert the local Affiliate mirror
- `referral.lead` — logged for audit (not a click tracker)
- `referral.created` — parsed; no conversion side effects
- `referral.converted` — completes `UNRESOLVED` referrals; may link via `stripe_customer_id`
- `commission.created` / `commission.updated` / `commission.paid` / `commission.voided` — upsert `AffiliateCommission`
- `payout.created` / `payout.paid` — audit log only (no money movement)

Same claim-based dedupe as Stripe (Rewardful provider).

## Environment variables

**API** (affiliate-specific):

```bash
AFFILIATES_ENABLED=true
STRIPE_SECRET_KEY=sk_...
REWARDFUL_WEBHOOK_SECRET=whsec_...
AFFILIATE_ADMIN_EMAILS=founder@example.com,admin@example.com
```

`STRIPE_SECRET_KEY` is required for the flag to be effective (see `affiliates-feature-flag.ts`). Stripe billing still uses the usual `STRIPE_WEBHOOK_SECRET` / price IDs.

**Dashboard**:

```bash
NEXT_PUBLIC_AFFILIATES_ENABLED=true
NEXT_PUBLIC_REWARDFUL_API_KEY=pk_...
```

## Database schema

- **WebhookEvent**: Deduplication (`provider` + `event_id` unique)
- **UserReferral**: User-level capture (`user_id` unique, `status`, `attributed_organization_id` unique nullable)
- **Affiliate**: Rewardful affiliate data (`rewardful_affiliate_id` unique, `link_token`)
- **OrganizationReferral**: Org-level attribution (`organization_id` unique, `status`, `needs_attention`)
- **AffiliateCommission**: Commission mirror (`rewardful_commission_id` unique)

## Testing

```bash
# Full API suite — affiliate env unset in the process; each affiliate file sets env in beforeAll
cd apps/api
RUN_DB_INTEGRATION_TESTS=true pnpm test

# Affiliate files
pnpm test affiliates.integration
pnpm test affiliates-protections.integration

# Dedupe + affiliate files with a non-UTC database timezone
psql "$DATABASE_URL" -c "ALTER DATABASE ci SET timezone TO 'Europe/Ljubljana';"
RUN_DB_INTEGRATION_TESTS=true pnpm test \
  src/lib/webhook-dedupe.test.ts \
  src/routes/stripe-webhook-dedupe.integration.test.ts \
  src/routes/affiliates.integration.test.ts \
  src/routes/affiliates-protections.integration.test.ts
```

Do **not** use `DATABASE_URL=...?options=-c TimeZone=...` as the timezone recipe. Session `TimeZone` is not the check; set the database default with `ALTER DATABASE ... SET timezone`.

Affiliate integration tests stub the Stripe SDK. They must not call `api.stripe.com`.

## Migration

Unreleased migration: `20261004180000_add_affiliate_tables`

```bash
npx prisma migrate dev
```

## Known limitations

- Rewardful API is not called during registration (V1)
- UUID-only referrals remain `UNRESOLVED` until `referral.converted`
- Commission calculation is handled entirely by Rewardful
