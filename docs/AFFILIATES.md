# Native affiliate program

Telemetry Tracker owns referral attribution and commission accounting. Stripe remains the source of truth for payments. There is no Rewardful (or other affiliate SaaS) account, script, API, webhook, or secret in runtime.

When the feature flag is **OFF** (the default), signup and billing behave exactly as they did before affiliates: no referral capture, no `WebhookEvent` rows for Stripe, no `tt_*` checkout metadata, no commissions.

## KEEP / MODIFY / REMOVE (Rewardful → native)

| Piece | Decision | Notes |
| --- | --- | --- |
| `AFFILIATES_ENABLED` / `NEXT_PUBLIC_AFFILIATES_ENABLED` | **KEEP** | Still OFF by default. Effective ON only with `STRIPE_SECRET_KEY`. |
| `UserReferral` + first-org lock | **KEEP** | Canonical user capture; `attributed_organization_id` claimed once. |
| 60-day last-touch window | **KEEP** | Evaluated at signup (`>` not `>=`). Day 60 valid, day 61 expired. |
| Self-referral + email normalize | **KEEP** | Gmail/`googlemail` +tag/dot rules unchanged. |
| `isPayoutHold` / founder resolve | **KEEP** | Hold for self-referral-risk reasons; founder-only audited resolve. Never rewrite `affiliate_id`. |
| Stripe Customer reuse + `tt_*` | **KEEP** | Checkout reuses `stripe_customer_id`. `tt_org_id` / `tt_affiliate_id` only when ACTIVE and not held. |
| Stripe webhook dedupe (`WebhookEvent`) | **KEEP** | Stripe only; still gated on the affiliate flag. |
| Founder admin allowlist | **KEEP** | `AFFILIATE_ADMIN_EMAILS`. Routes 404 when the flag is OFF. |
| `Affiliate` table | **MODIFY** | Founder-created. Public `code` (case-insensitive). No Rewardful IDs. |
| `OrganizationReferral` | **MODIFY** | Stores `referral_code` instead of Rewardful UUID / via token. |
| `AffiliateCommission` | **MODIFY** | Native ledger: one row per Stripe invoice. States pending → payable → paid / voided. |
| `AffiliateAdjustment` / `AffiliatePayout` | **MODIFY** | Added by forward migration `20261005180000_affiliate_rewardful_to_native` (after the Rewardful-shaped `20261004180000` already applied in production 1.17.27). |
| Rewardful JS (`r.wdfl.co`), `RewardfulLoader` | **REMOVE** | Replaced by first-party `?ref=` capture + sessionStorage / optional cookie. |
| `REWARDFUL_*` env, `/webhooks/rewardful` | **REMOVE** | No Rewardful secrets or routes. |
| Stripe `metadata.referral` | **REMOVE** | Commissions come from TT attribution + `invoice.paid`, not Rewardful conversion. |
| Rewardful webhook / commission mirror tests | **REMOVE** | Replaced by native invoice / refund / dispute / payout tests. |

## Feature flag

Effective ON only when **both** are set:

```bash
AFFILIATES_ENABLED=true
STRIPE_SECRET_KEY=sk_...
```

Dashboard forwarding uses `NEXT_PUBLIC_AFFILIATES_ENABLED=true` independently. Leave both unset unless you intend to enable the program.

`NEXT_PUBLIC_AFFILIATES_ENABLED` is a **build-time** flag: Next.js inlines it into the dashboard bundle during `next build` (the client-side `?ref=` capture reads it in the browser). The root `Dockerfile` declares it as an `ARG` so Railway passes the dashboard service variable into the build; unset means OFF. Changing it requires a **rebuild** of the dashboard (Railway's deploy on variable change, or a new commit) — redeploying an existing/cached image (e.g. `redeploy` of a previous build, or Skipped Builds) keeps the old value.

When OFF:

- Registration ignores `referralCode`
- Checkout sessions have no `tt_*`
- Stripe webhooks still upgrade the org, but do **not** write `WebhookEvent` rows or commissions
- Founder admin routes return 404

## Visitor → signup

1. Affiliate shares `https://telemetry-tracker.com/?ref=<code>` (`?via=` is accepted as an alias).
2. Last-touch wins. `ReferralCapture` always writes **sessionStorage** (same-session fallback without marketing cookies). After optional-cookie consent, a remembered sessionStorage referral is promoted into a first-party `tt_affiliate_ref` cookie for 60 days even if `?ref=` is no longer in the URL.
3. Register sends `referralCode` + `referralCapturedAt`. Declining optional cookies does not drop same-session attribution. No fingerprinting.
4. Only **active** affiliates resolve. Codes are case-insensitive, 2–64 characters, and must not be UUIDs.
5. Attribution locks at signup. Later links and existing accounts cannot gain or change it.

## Attribution

- TT database is canonical. One organization ≤ one affiliate.
- First organization created by the referred user claims `UserReferral.attributed_organization_id`.
- Status: `ACTIVE` (in-window, resolved), `EXPIRED` (day 61+ at signup), `REJECTED` (self-referral).
- Free → paid (including much later) still commissions the locked affiliate.
- Self-hosted revenue is never commissioned (no hosted Stripe subscription invoice).

## Commissions

On Stripe `invoice.paid` for a hosted subscription invoice:

1. Resolve org from Customer / subscription / metadata.
2. Load canonical `OrganizationReferral`.
3. Skip unless `ACTIVE`, affiliate is active, not a payout hold, and the org is hosted **PRO** or **BUSINESS**. Eligibility is `org.plan_tier` **or** Stripe subscription metadata on the invoice (`parent.subscription_details.metadata.plan_tier` / `subscription_details.metadata.plan_tier` written at checkout). If `org.plan_tier` is still FREE (checkout.session.completed has not landed) and that metadata is missing or ambiguous, the webhook **fails** so Stripe retries — it is not marked processed and skipped forever. Explicit FREE metadata, self-hosted invoices, and zero-eligible paid amounts are never commissioned.
4. Eligible base = `amount_paid − tax` (integer cents). Discounts and customer credits are already reflected in `amount_paid`. If eligible base is 0, no commission.
5. Commission = `floor(eligible × 30%)`. Exactly one row per `stripe_invoice_id` (idempotent). Store `stripe_payment_intent_id` and/or `stripe_charge_id` from classic invoice fields or basil InvoicePayment.
6. Recurring invoices each create another commission. Cancel stops future invoices. A later legitimate resubscription of the same hosted org commissions the original locked affiliate again.

Hold: `payable_at = invoice_paid_at + 30 days`. Effective state `payable` is derived (pending + hold elapsed + no open dispute + remaining > 0). Self-hosted (non-subscription) invoices are never commissioned.

## Stripe webhooks

The API constructs `new Stripe(key)` with **no `apiVersion` pin**, so outbound Stripe calls use **stripe v22’s SDK default (dahlia)**. Webhook **payload** shape is set by the Dashboard endpoint pin, not the SDK. Pin `POST /webhooks/stripe` to **`2025-03-31.basil` or later** (basil or dahlia) so `InvoicePayment` is present. Older pins still send `invoice.charge` / `charge.invoice`; the engine accepts both classic and basil+ payloads.

When affiliates are enabled, the endpoint must also receive:

- `invoice.paid` — record the commission. Payment is resolved from classic `invoice.charge` / `invoice.payment_intent`, or basil+ `invoice.payments` / `invoicePayments.list({ invoice })`. If `invoicePayments.list` fails, the webhook errors so Stripe retries (no commission row without payment ids). Stored `stripe_payment_intent_id` (and charge id when present) is what refunds and disputes match on.
- `charge.refunded` — reduce remaining or create a post-payout clawback. Match by `charge.payment_intent`, then legacy `charge.invoice` / `invoice.charge`.
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

Billing still needs `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted` (see [BILLING.md](./BILLING.md)).

If a refund or dispute arrives for a **referred** org/customer and no commission row matches, the webhook logs a warning, sets `OrganizationReferral.needs_attention` (`commission_not_found_refund_or_dispute`), and writes an audit row. That is not a payout hold; founders see it on the affiliate org list and can resolve it.

## Refunds and disputes

- **Refund before payout:** reduce `remaining_cents` or void the commission row only. Do **not** create an `AffiliateAdjustment` (that would double-count the refund in payable balance). History is the immutable `amount_cents` plus remaining/voided.
- **Refund after payout:** negative `AffiliateAdjustment` (post-payout clawback) against future payable balance. Commission stays `paid`. Clawback = `max(0, amount actually paid − desired remaining) − sum(all prior clawbacks for that commission, settled or open)`. Amount actually paid is `remaining_cents` at payout (pre-payout reductions are respected; a later settled clawback is not ignored).
- **Dispute open:** not payable; surfaced in founder admin (`dispute_status=open`) + email on livemode `charge.dispute.created`.
- **Dispute won:** restore normal eligibility/hold.
- **Dispute lost:** void the unpaid commission row only; negative `AffiliateAdjustment` if already paid, using the same clawback cap (never more than was paid net of earlier clawbacks).

Refund and dispute handlers take the same `SELECT … FROM "Affiliate" … FOR UPDATE` lock as mark-as-paid, re-read the commission inside the lock, and apply state-aware updates so a concurrent payout cannot overpay and cannot lose the clawback path.

No automated money movement.

## Manual payouts (V1)

Founder admin (`AFFILIATE_ADMIN_EMAILS`):

- Create affiliate (name / email / code), disable, inspect orgs / commissions / adjustments / balances.
- **Email is optional on create.** If the affiliate has no email, attributing an org sets `needs_attention` with `affiliate_email_unknown` (a **payout hold**: commissions are skipped until the founder adds an email and resolves the hold). Prefer supplying email when creating the affiliate.
- Payable balance = `sum(payable commissions' remaining_cents)` + `sum(open post-payout adjustments)`. Pre-payout partial refunds are not subtracted twice. `paidCents` is the sum of **paid** commissions' `remaining_cents` (what was actually paid out), not the original `amount_cents`.
- Eligible when payable ≥ €50 (5000 minor units).
- `POST /api/meta/affiliates/:id/payouts` — select commissions; every unsettled clawback is auto-included. `amountCents` must equal selected remaining + those clawbacks (`amount_mismatch` if clawbacks are omitted from the amount; `overpay` if amount exceeds true net payable). Concurrent submit without an idempotency key returns `already_paid` (no phantom payout). Idempotent via `idempotencyKey`. Disabled affiliates may still be paid already-earned commissions. Individual commission rows are preserved as `paid`.

There is no public application form and no automated Wise/SEPA/PayPal payout.

## Founder resolve

`POST /api/meta/affiliates/organizations/:orgId/resolve-needs-attention`

Clears a genuine hold (`needs_attention`). Refuses `REJECTED` / `EXPIRED`. Never changes canonical `affiliate_id`. Updates existing Stripe Customer `tt_*` only (never `customers.create`).

## Environment

**API** (all commented / unset by default):

```bash
# AFFILIATES_ENABLED=true
# AFFILIATE_ADMIN_EMAILS=founder@example.com
```

**Dashboard:**

```bash
# NEXT_PUBLIC_AFFILIATES_ENABLED=true
```

## Database

Production API **1.17.27** already applied `20261004180000_add_affiliate_tables` on boot via `migrateDeployBeforeListen`. That file is the **Rewardful-shaped** original (`rewardful_*` columns; no `Affiliate.code`, `AffiliatePayout`, `AffiliateAdjustment`, or `stripe_payment_intent_id`). This PR restores it to match `main` byte-for-byte — do not rewrite it in place.

Forward migration `20261005180000_affiliate_rewardful_to_native` converts those tables to the native schema:

- `Affiliate` (code, name, email, state, 30% rate)
- `UserReferral` / `OrganizationReferral` (`referral_code` instead of Rewardful ids / via-token)
- `AffiliateCommission` (includes `stripe_payment_intent_id` for basil+ charge↔invoice linking)
- `AffiliateAdjustment` / `AffiliatePayout`
- `WebhookEvent` (unchanged; created by `20261004180000`)

Production tables are expected **empty** (flags never enabled; Rewardful never used). The forward migration still uses ALTER / ADD COLUMN / backfill / DROP so leftover rows cannot block NOT NULL.

**Local/CI:** any database that already applied the *edited* (native) checksum of `20261004180000` will fail Prisma’s checksum check against the restored original. Reset (`prisma migrate reset`) or `prisma migrate resolve` as appropriate. Fresh databases apply original `20261004180000` then the forward migration.

Do **not** enable feature flags from this PR. Do **not** run production migrations until the founder explicitly enables the program.

## Testing

```bash
cd apps/api
RUN_DB_INTEGRATION_TESTS=true pnpm test
```

Affiliate files set the flag in `beforeAll`; the process default stays unset.
