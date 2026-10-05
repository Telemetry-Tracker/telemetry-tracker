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
| `AffiliateAdjustment` / `AffiliatePayout` | **MODIFY** | New ledger tables on the same migration (unreleased). |
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
3. Skip unless `ACTIVE`, affiliate is active, and not a payout hold.
4. Eligible base = `amount_paid − tax` (integer cents). Discounts and customer credits are already reflected in `amount_paid`. If eligible base is 0, no commission.
5. Commission = `floor(eligible × 30%)`. Exactly one row per `stripe_invoice_id` (idempotent).
6. Recurring invoices each create another commission. Cancel stops future invoices. A later legitimate resubscription of the same hosted org commissions the original locked affiliate again.

Hold: `payable_at = invoice_paid_at + 30 days`. Effective state `payable` is derived (pending + hold elapsed + no open dispute + remaining > 0).

## Refunds and disputes

- **Refund before payout:** reduce `remaining_cents` or void the commission row only. Do **not** create an `AffiliateAdjustment` (that would double-count the refund in payable balance). History is the immutable `amount_cents` plus remaining/voided.
- **Refund after payout:** negative `AffiliateAdjustment` (post-payout clawback) against future payable balance. Commission stays `paid`.
- **Dispute open:** not payable; surfaced in founder admin (`dispute_status=open`) + email on livemode `charge.dispute.created`.
- **Dispute won:** restore normal eligibility/hold.
- **Dispute lost:** void the unpaid commission row only; negative `AffiliateAdjustment` if already paid.

No automated money movement.

## Manual payouts (V1)

Founder admin (`AFFILIATE_ADMIN_EMAILS`):

- Create affiliate (name / email / code), disable, inspect orgs / commissions / adjustments / balances.
- Payable balance = `sum(payable commissions' remaining_cents)` + `sum(open post-payout adjustments)`. Pre-payout partial refunds are not subtracted twice.
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

Unreleased migration `20261004180000_add_affiliate_tables` (edited in place because it has not been applied in production):

- `WebhookEvent`
- `Affiliate` (code, name, email, state, 30% rate)
- `UserReferral` / `OrganizationReferral`
- `AffiliateCommission` / `AffiliateAdjustment` / `AffiliatePayout`

Do **not** run this migration against production until the founder explicitly enables the program.

## Testing

```bash
cd apps/api
RUN_DB_INTEGRATION_TESTS=true pnpm test
```

Affiliate files set the flag in `beforeAll`; the process default stays unset.
