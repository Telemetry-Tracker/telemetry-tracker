# Production readiness checklist

Use this before exposing Telemetry Tracker on the public internet or handing it to a production team. For tagging, GitHub Releases, and the Railway deploy runbook, see [RELEASE.md](./RELEASE.md).

## Security

| Item | Action |
|------|--------|
| Ingest auth | **`INGEST_ALLOW_UNAUTHENTICATED` must be off** in production. SDKs must send `apiKey` (`tt_live_…`). |
| Dashboard reads | With `NODE_ENV=production`, `GET /api/*` requires a session. Do not set `TELEMETRY_ALLOW_UNAUTHENTICATED_READS` unless you have a deliberate legacy tooling need. |
| CORS | Set `CORS_ORIGINS` or `DASHBOARD_ORIGIN` so only your dashboard origin can call the API with credentials. |
| Registration | After bootstrap, set `TELEMETRY_ALLOW_REGISTRATION=false` (or omit) for invite-only; `true` for open signups. See [REGISTRATION-POLICY.md](./REGISTRATION-POLICY.md). |
| Secrets | Store `DATABASE_URL`, Stripe keys, and API keys in your platform secret manager — never in git. |
| HTTPS | Terminate TLS at your reverse proxy / Railway / load balancer for both API and dashboard. |

## Operations

| Item | Action |
|------|--------|
| Database | Managed Postgres with [automated backups and a tested restore procedure](./RAILWAY.md#postgresql-backups-and-restore). |
| Migrations | Run `pnpm --filter api exec prisma migrate deploy` on every API deploy (CI does this on `main`). |
| Retention | Schedule the retention job nightly (see [RAILWAY.md](./RAILWAY.md#retention-cron)). Without it, telemetry grows until manual cleanup. Verify locally with `pnpm --filter api retention -- --dry-run`. |
| Health | Set `HEALTH_CHECK_DATABASE=true` on the API so `GET /health` verifies Postgres and reports `database_latency_ms`. Optional `HEALTH_DETAILED=true` adds uptime and Node version. `/health` `version` is set at build from CHANGELOG; override with `TELEMETRY_API_VERSION` only if needed. |
| Observability | Optional `SENTRY_DSN` on the API for uncaught errors. External uptime on `/health` and dashboard — see [MONITORING.md](./MONITORING.md). Monitor API 5xx, ingest 429 rate, and disk/DB size. `GET /health` reports `"email":"configured"` or `"not_configured"`, plus `version` on every response. |
| Rate limits | Tune `RATE_LIMIT_*` env vars if you see false positives from shared IPs. Per-project ingest RPS follows plan tiers in `apps/api/src/config/plans.ts`. |

## Billing (optional)

Stripe is optional for self-host. If enabled:

- Webhook endpoint: `POST /webhooks/stripe` with `STRIPE_WEBHOOK_SECRET`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Checkout metadata: `organization_id`, `plan_tier` on session or subscription/price

See [BILLING.md](./BILLING.md) and [ENTITLEMENTS.md](./ENTITLEMENTS.md).

## Bootstrap

1. Deploy Postgres, API, dashboard.
2. Open dashboard → register first user (allowed when DB is empty).
3. Create organization → project → API key.
4. Configure SDK: `init({ ingestUrl, app, apiKey })`.
5. Disable open registration if desired.

## Testing before go-live

```bash
pnpm lint
RUN_DB_INTEGRATION_TESTS=true pnpm test
pnpm build
```

**Automated external checks** (no Railway dashboard access):

```bash
./scripts/verify-prod-config.sh
```

Confirms HTTPS, `/health` database probe, ingest 401 without key, read 401 without session, CORS, and dashboard reachability — see [DEPLOYMENT.md](../DEPLOYMENT.md#verify-production-config).

Manually verify: login, overview loads, ingest with API key returns 200. Full E2E: `scripts/smoke-production.sh`.

## Known limitations (v1)

- Per-project ingest RPS bucket is **in-memory** (single API process). Horizontal scaling needs a shared rate limiter later.
- Password reset in production requires **`RESEND_API_KEY`** and **`TELEMETRY_EMAIL_FROM`** on the API (see [BILLING.md](./BILLING.md)); without them, admins must share reset links manually. Setup runbook: [BILLING.md → Production setup](./BILLING.md#production-setup-hosted-cloud).
- No built-in error spike alerts or Slack webhooks.
