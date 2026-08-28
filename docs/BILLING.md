# Billing and email (optional)

Stripe billing and Resend email are **optional** for self-hosted installs. Core deployment: [DEPLOYMENT.md](../DEPLOYMENT.md). Plan limits and ingest auth: [ENTITLEMENTS.md](./ENTITLEMENTS.md).

---

## Resend (invites, password reset, notifications, contact)

Without email configured, admins must share invite or reset links manually. In production the API logs a startup warning and `/health` reports `"email": "not_configured"`.

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | API key from [Resend](https://resend.com) |
| `TELEMETRY_EMAIL_FROM` | Sender address, e.g. `Telemetry Tracker <noreply@tacko.io>` |

Both are required for outbound email. Verify your sending domain in Resend for production.

Optional for the marketing contact form (`POST /api/contact`):

| Variable | Description |
|----------|-------------|
| `CONTACT_INBOX_EMAIL` | Inbox for form submissions (default `info@tacko.io`) |

The contact form uses the same Resend credentials as password reset. Resend will reject sends when:

- `TELEMETRY_EMAIL_FROM` uses `onboarding@resend.dev` but the recipient is not your Resend account email
- the domain in `TELEMETRY_EMAIL_FROM` is not verified in [Resend → Domains](https://resend.com/domains)

Check API logs for `[email] Resend failed:` for the exact rejection reason.

### What uses email

| Flow | Trigger | Notes |
|------|---------|--------|
| Organization invite | Team settings → invite by email | Requires `TELEMETRY_DASHBOARD_ORIGIN` for invite URL |
| Password reset | `POST /api/auth/forgot-password` | Same origin requirement for reset link |
| Notification email | Billing alerts, quota thresholds, new error groups, team joins | Respects per-user notification preferences |
| Contact form | `POST /api/contact` | Delivers to `CONTACT_INBOX_EMAIL` with `replyTo` set to submitter |
| Product updates | Footer subscribe, registration opt-in | Stored in `MarketingSubscriber`; see [MARKETING-EMAIL.md](./MARKETING-EMAIL.md) |

### Production setup (hosted cloud)

Use this checklist for **telemetry-tracker.com** on Railway (API service only — dashboard does not need Resend vars).

#### 1. Resend account and API key

1. Sign in at [resend.com](https://resend.com).
2. **API Keys** → Create key (e.g. `telemetry-tracker-production`) with **Sending access**.
3. Copy the key (`re_…`) — shown once.

#### 2. Verify sending domain

The hosted cloud sends from **tacko.io** (operator domain). `telemetry-tracker.com` is the app URL, not the mail-from domain.

1. **Domains** → **Add domain** → `tacko.io`.
2. Add the DNS records Resend shows (typically **SPF**, **DKIM**, and optionally **DMARC**) at your DNS host for `tacko.io`.
3. Wait until Resend shows the domain as **Verified**.

Recommended sender:

```env
TELEMETRY_EMAIL_FROM=Telemetry Tracker <noreply@tacko.io>
CONTACT_INBOX_EMAIL=info@tacko.io
```

You can use another verified domain if you prefer; `TELEMETRY_EMAIL_FROM` must match it exactly.

#### 3. Railway API environment

On the **API** Railway service (not dashboard), set:

| Variable | Example |
|----------|---------|
| `RESEND_API_KEY` | `re_…` |
| `TELEMETRY_EMAIL_FROM` | `Telemetry Tracker <noreply@tacko.io>` |
| `CONTACT_INBOX_EMAIL` | `info@tacko.io` |
| `TELEMETRY_DASHBOARD_ORIGIN` | `https://telemetry-tracker.com` |

Redeploy the API after saving variables.

#### 4. Verify delivery

```bash
# Health should show email configured
curl -sS https://api.telemetry-tracker.com/health
# → {"ok":true,"database":"ok","email":"configured"}

# Contact form (expect 200 ok:true when Resend accepts)
curl -sS -X POST https://api.telemetry-tracker.com/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"you@example.com","topic":"general","message":"Resend production verification — please ignore."}'

# Password reset (always 200; check inbox for link)
curl -sS -X POST https://api.telemetry-tracker.com/api/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"your-account@example.com"}'
```

Also send a team invite from **Settings → Team** and confirm the invitee receives mail.

If delivery fails, check Railway API logs for `[email] Resend failed:` and confirm domain verification in the Resend dashboard.

---

## Stripe (paid plans, EUR)

Set these on the **API** service to enable checkout, billing portal, and webhooks:

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | `sk_live_…` or test key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` for `POST /webhooks/stripe` |
| `STRIPE_PRICE_PRO` | Stripe Price id for Pro (**EUR**, list price €15/mo). New checkouts use this Price; existing subscribers keep their prior Price until they change plan. |
| `STRIPE_PRICE_BUSINESS` | Stripe Price id for Business (**EUR**, list price €99/mo) |
| `TELEMETRY_DASHBOARD_ORIGIN` or `DASHBOARD_ORIGIN` | Dashboard URL for checkout return links |

### Stripe Dashboard setup

1. **Webhook endpoint:** `https://<your-api>/webhooks/stripe`
2. **Subscribe to events:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. **Checkout metadata** on completed sessions: `organization_id` (UUID), `plan_tier` (`PRO` or `BUSINESS`).
4. For subscription-only plan changes, put the same `plan_tier` on **Subscription** or **Price** metadata so `customer.subscription.updated` can sync tier.

Do **not** rely on `invoice.payment_failed` alone for subscription status — use **`customer.subscription.updated`** (Stripe retries while status may still be `active`).

Test with Stripe CLI or Dashboard **Send test webhook** after deploy.

---

## Production checklist

- [ ] Resend domain verified (`tacko.io` or your sending domain) — see [Resend production setup](./BILLING.md#production-setup-hosted-cloud)
- [ ] `RESEND_API_KEY` and `TELEMETRY_EMAIL_FROM` set on Railway API; `/health` shows `"email":"configured"`
- [ ] Test invite, password reset, and contact form delivery
- [ ] Stripe webhook URL reachable from the internet
- [ ] Webhook secret matches `STRIPE_WEBHOOK_SECRET`
- [ ] Test checkout completes and org tier updates

See [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) for the full go-live list.
