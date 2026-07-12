# Production monitoring and alerting

GitHub issue [#93](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/93) — know when the hosted cloud is down or degrading before customers do.

## What to monitor

| Signal | How | Alert when |
|--------|-----|------------|
| **API liveness** | `GET /health` → `200`, `"ok":true`, `"database":"ok"` | Non-200, `ok:false`, or DB unavailable |
| **Dashboard reachability** | `GET https://telemetry-tracker.com` → `200` | Non-200 or TLS errors |
| **Ingest auth** | `POST /ingest/event` without API key → `401` | Returns 200/204 without key (misconfiguration) |
| **Uncaught API errors** | [Sentry](#sentry-optional) (`SENTRY_DSN` on API) | New error groups or spike in volume |
| **Uncaught dashboard errors** | [Sentry](#sentry-optional) (`SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` on dashboard) | New error groups or spike in volume |
| **Ingest quota pressure** | Railway API logs / metrics — `429` responses | Sustained 429 rate above baseline |
| **API 5xx** | Sentry + Railway deploy logs | Any 5xx spike after deploy |
| **Retention cron** | Railway `retention-cron` service — last run exited 0 | Failed run, stuck deployment, or missing `"ok":true` in logs |
| **Database backups** | Railway Postgres → Backups tab | Backup job failed or backups disabled |

Public health shape (no secrets):

```bash
curl -sS https://api.telemetry-tracker.com/health
# → {"ok":true,"version":"1.7.3","email":"configured","database":"ok","database_latency_ms":5}
```

When `HEALTH_CHECK_DATABASE=true` and Postgres is down, `/health` returns **503** with `"ok":false`.

---

## Built-in: GitHub Actions uptime (hosted cloud)

Workflow [`.github/workflows/production-uptime.yml`](../.github/workflows/production-uptime.yml) runs every **15 minutes** on `main`:

- Runs [`scripts/check-production-uptime.sh`](../scripts/check-production-uptime.sh)
- Probes API `/health`, dashboard home, and ingest 401 without key

**Get notified on failure:**

1. GitHub → **Settings → Notifications** → enable **Actions** email (or watch the repo).
2. Optional: add a workflow step that posts to Slack (webhook secret) — not included by default; use an external uptime tool if you prefer Slack-only routing.

**Manual run:** Actions → **Production uptime** → **Run workflow**.

**Self-hosted deployments:** copy the script and workflow; set `UPTIME_API_URL` and `UPTIME_DASHBOARD_URL`.

```bash
UPTIME_API_URL=https://api.example.com UPTIME_DASHBOARD_URL=https://app.example.com \
  ./scripts/check-production-uptime.sh
```

Optional slow-DB alert threshold (milliseconds):

```bash
UPTIME_MAX_DB_LATENCY_MS=2000 ./scripts/check-production-uptime.sh
```

---

## External uptime (recommended redundancy)

Use a second monitor so alerts still fire if GitHub Actions is unavailable.

| Service | Check | Interval |
|---------|-------|----------|
| [UptimeRobot](https://uptimerobot.com/) | HTTPS `https://api.telemetry-tracker.com/health` — keyword `ok` | 5 min |
| Same | HTTPS `https://telemetry-tracker.com` | 5 min |
| [Better Stack](https://betterstack.com/uptime) | Multi-step HTTP checks | 3–5 min |

Point alert contacts to **info@tacko.io** or your team Slack/email.

---

## Sentry (optional)

Uncaught API errors are reported when `SENTRY_DSN` is set on the **API** service ([`apps/api/src/lib/observability.ts`](../apps/api/src/lib/observability.ts)).

Uncaught dashboard errors (server, edge, and client error boundaries) are reported when both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are set on the **dashboard** service ([`apps/dashboard/lib/sentry.ts`](../apps/dashboard/lib/sentry.ts), `@sentry/nextjs`).

### Railway setup

1. Create Sentry projects — Node / Fastify for API, Next.js for dashboard (or reuse one project).
2. **API** service → **Variables** → `SENTRY_DSN=https://…@sentry.io/…`
3. **Dashboard** service → **Variables** → `SENTRY_DSN=https://…@sentry.io/…` and `NEXT_PUBLIC_SENTRY_DSN=https://…@sentry.io/…` (same DSN value)
4. Redeploy both services.
5. Trigger a test error in staging or verify events in Sentry after a deploy.

**Optional source maps (dashboard):** set `SENTRY_AUTH_TOKEN` in CI to upload `.map` files after release — see [DEPLOYMENT.md](../DEPLOYMENT.md#source-maps). Not required for error capture.

**Alert rules (Sentry dashboard):**

- New issue in `production`
- Issue frequency above threshold (error spike)
- Regression after release (compare to deploy tag / `version` in `/health`)

Sentry does **not** replace uptime checks — it captures application exceptions, not “site down”.

---

## Railway platform alerts

In the Railway project:

1. **Deploy notifications** — enable for API and dashboard services (failed build/deploy).
2. **Postgres** — confirm daily backups; review backup failure emails from Railway.
3. **Retention cron** — after each scheduled run, confirm deployment status **Completed** (exited) and log line `"ok":true`. See [RAILWAY.md](./RAILWAY.md#retention-cron).
4. **Metrics** — watch CPU/memory and HTTP error rates in the service Metrics tab; tune plan if ingest volume grows.

---

## Ingest 429 and API 5xx

There is no first-party metrics dashboard for ops in v1. Practical approach:

| Metric | Where to look | Action |
|--------|---------------|--------|
| **429 Too Many Requests** | Railway API logs (filter `429`); customer reports | Review `RATE_LIMIT_*` env and plan tiers in `apps/api/src/config/plans.ts` |
| **5xx** | Sentry; Railway deploy/runtime logs | Roll back deploy or fix regression; check DB connectivity |
| **DB size / disk** | Railway Postgres metrics | Confirm retention cron runs; review backup retention |

Dashboard **project-level** alerts (error spikes, quota) are for **customers**, not platform ops — see in-app Alerts settings.

---

## On-call and response (tacko.io)

| Severity | Examples | Response |
|----------|----------|----------|
| **P1 — site down** | `/health` 503, dashboard 5xx, ingest down | Acknowledge within 15 min; restore service (Railway redeploy, DB restore, rollback `main`) |
| **P2 — degraded** | Elevated 429, slow `database_latency_ms`, email `not_configured` | Investigate within 4 h; fix config or scale |
| **P3 — background** | Retention cron warning, backup reminder | Next business day |

**Runbook quick steps (P1):**

1. Confirm outage: `./scripts/check-production-uptime.sh` or `curl /health`.
2. Railway → API service → **Deployments** — last deploy green? **Redeploy** if crash loop.
3. Railway → Postgres — service running? Restore from backup if data corruption ([RAILWAY.md](./RAILWAY.md#postgresql-backups-and-restore)).
4. Check [GitHub Actions](https://github.com/Telemetry-Tracker/telemetry-tracker/actions/workflows/production-uptime.yml) for probe history.
5. Post-incident: note in GitHub issue or internal log; update this doc if steps were missing.

**Contacts:** maintainer @unjica · **info@tacko.io**

---

## Acceptance checklist (#93)

- [ ] `SENTRY_DSN` set on production API (optional but recommended)
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` set on production dashboard (optional but recommended)
- [ ] GitHub **Production uptime** workflow enabled (on `main`)
- [ ] External uptime monitor configured (redundancy)
- [ ] Alert channel defined (GitHub Actions email and/or UptimeRobot → email/Slack)
- [ ] Team aware of on-call table above
- [ ] `./scripts/check-production-uptime.sh` passes manually

## Related

- [`scripts/verify-prod-config.sh`](../scripts/verify-prod-config.sh) — broader config verification (#85)
- [`scripts/smoke-production.sh`](../scripts/smoke-production.sh) — full E2E after deploy
- [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) · [RAILWAY.md](./RAILWAY.md) · [DEPLOYMENT.md](../DEPLOYMENT.md)
