# Deployment guide

Telemetry Tracker has three runtime pieces:

1. **PostgreSQL** — database (required by the API)
2. **API** (`apps/api`) — Fastify ingest + read API (port 3001 locally; platform-assigned in production)
3. **Dashboard** (`apps/dashboard`) — Next.js UI (port 3000 locally)

The dashboard calls the API via **`API_URL`** (server-side only). The API uses **`DATABASE_URL`** for Postgres.

**Repo layout:** `Dockerfile` and `docker-compose.yml` live at the **repo root**. The Dockerfile builds the **dashboard only** (context must be repo root). The API has no Dockerfile in this repo.

---

## Environment variables (core)

Copy `apps/api/.env.example` and `apps/dashboard/.env.example` for local dev.

### API — required in production

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | Set `production` for production CORS and auth behavior |
| `HOST` | `0.0.0.0` on PaaS (default) |
| `CORS_ORIGINS` or `DASHBOARD_ORIGIN` | Dashboard origin(s) when `NODE_ENV=production` |
| `TELEMETRY_DASHBOARD_ORIGIN` | Base URL for invite links (no trailing slash) |

### API — recommended

| Variable | Description |
|----------|-------------|
| `HEALTH_CHECK_DATABASE` | `true` — `GET /health` checks Postgres and reports `database_latency_ms` |
| `HEALTH_DETAILED` | `true` — add `uptime_seconds` and `node_version` to `/health` (no secrets) |
| `TELEMETRY_API_VERSION` | Optional override for `/health` `version`; normally set automatically at build from [CHANGELOG.md](../CHANGELOG.md) |
| `TELEMETRY_ALLOW_REGISTRATION` | `true` for open signups; omit or `false` for invite-only after bootstrap — see [docs/REGISTRATION-POLICY.md](docs/REGISTRATION-POLICY.md) |
| `SENTRY_DSN` | Optional uncaught-error reporting |
| `TELEMETRY_INGEST_PII_SCRUB` | Ingest PII scrubbing — **enabled when unset**. Self-host override: set `false` / `off` to store payloads as sent. See [docs/PII-SCRUBBING.md](docs/PII-SCRUBBING.md) |
| `TELEMETRY_INGEST_PII_SCRUB_MAX_DEPTH` | Max JSON nesting depth for property/context scrubbing (default `8`) |
| `TELEMETRY_INGEST_PII_SCRUB_MAX_NODES` | Max JSON nodes visited per payload (default `500`) |

### API — never in production

| Variable | Why |
|----------|-----|
| `INGEST_ALLOW_UNAUTHENTICATED` | Ingest must use API keys |
| `TELEMETRY_ALLOW_UNAUTHENTICATED_READS` | Dashboard reads require login |

Rate limits (`RATE_LIMIT_*`), legacy org fallback (`TELEMETRY_ORGANIZATION_ID`), and ingest dev flags are documented in [docs/ENTITLEMENTS.md](docs/ENTITLEMENTS.md).

**Email (Resend) and Stripe billing** — optional; see [docs/BILLING.md](docs/BILLING.md).

### Dashboard

| Variable | Description |
|----------|-------------|
| `API_URL` | Public API base URL (no trailing `/`). Default locally: `http://localhost:3001` |
| `NEXT_PUBLIC_SITE_URL` | Public dashboard URL for SEO/metadata (recommended in production) |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Optional Google Search Console HTML-tag verification token |
| `SENTRY_DSN` | Optional server/edge uncaught-error reporting |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional browser error reporting (same DSN value as `SENTRY_DSN`) |

Do not set `NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD=true` on a public production URL.

**`NEXT_PUBLIC_*` are build-time.** Next.js inlines them into the bundle during `next build` (client code always; server code too when the variable is present at build). The root `Dockerfile` declares every `NEXT_PUBLIC_*` the dashboard reads as an `ARG` (+ `ENV`) in the build stage so Railway (Dockerfile builder) passes the service variables into the build; with plain Docker use `--build-arg NAME=value`. Unset → empty → same as unset. Changing any of them requires a **rebuild** of the dashboard — redeploying an existing/cached image keeps the old values. When the dashboard starts reading a new `NEXT_PUBLIC_*`, add it to the `Dockerfile` too. These values ship to browsers by design: never put secrets in a `NEXT_PUBLIC_*` variable or a dashboard build `ARG` (Sentry source-map upload credentials such as `SENTRY_AUTH_TOKEN` are intentionally not passed into the image build).

Declared build args: `NEXT_PUBLIC_AFFILIATES_ENABLED`, `NEXT_PUBLIC_DASHBOARD_DEBUG`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TELEMETRY_API_KEY`, `NEXT_PUBLIC_TELEMETRY_APP`, `NEXT_PUBLIC_TELEMETRY_INGEST_URL`, `NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD`.

---

## Build and run

From repo root:

```bash
pnpm install
pnpm build
```

### Database migrations

**Local development** — applies migrations and can **create new migration files** (use only when changing the Prisma schema):

```bash
pnpm db:migrate
```

**Production** — applies existing migrations only; never creates new files on the server:

```bash
pnpm --filter api exec prisma migrate deploy
```

| Task | Command |
|------|---------|
| Dev API | `pnpm dev:api` |
| Dev dashboard | `pnpm dev:dashboard` |
| Prod API | `pnpm --filter api start` |
| Prod dashboard | `pnpm --filter dashboard start` |

---

## Where to deploy

| Target | Guide |
|--------|--------|
| **Railway** (recommended PaaS) | [docs/RAILWAY.md](docs/RAILWAY.md) — Postgres, API, dashboard, cron, troubleshooting |
| **Single VPS** | Postgres + API + dashboard on one host; reverse proxy (Nginx/Caddy) for HTTPS |
| **Docker / local infra** | Local Postgres via `docker compose up -d`; root `Dockerfile` builds the **dashboard image only** — no API Dockerfile in this repo |

This repo does **not** ship a single Docker Compose stack for all three production services. For production, use Railway, a VPS, or build your own orchestration.

**VPS sketch:** install Postgres 16 (or Docker), clone repo, set `DATABASE_URL`, `pnpm build`, run migrations, start API and dashboard with a process manager, terminate TLS at the proxy.

**Retention:** schedule the retention job nightly so old telemetry is pruned — see [docs/RAILWAY.md](docs/RAILWAY.md#retention-cron) or run `node dist/jobs/run-retention.js` from `apps/api` on your scheduler.

**Alert rules evaluator (optional):** for `HEARTBEAT` / `NO_EVENTS` / `SESSION_DROP` / `QUOTA_PERCENT` (and scheduled `ERROR_RATE`) conditions, schedule `node dist/jobs/run-alert-rules-evaluator.js` every 5 minutes — see [docs/RAILWAY.md](docs/RAILWAY.md#alert-rules-evaluator-cron) and [docs/ALERT-RULES.md](docs/ALERT-RULES.md).

**Source maps in CI:** upload `.map` files after each release with the [upload-source-maps GitHub Action](.github/actions/upload-source-maps). Set `base_api_url` to your public API URL (`API_URL` on the dashboard). Details: [docs/source-maps.md](docs/source-maps.md#github-action-workflow-example).

---

## Before going live

Use [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) for the full security and operations checklist.

### Verify production config

After Railway env vars are set, run external checks (no dashboard login required):

```bash
chmod +x scripts/verify-prod-config.sh
./scripts/verify-prod-config.sh
# Custom hosts: VERIFY_API_URL=https://api.example.com VERIFY_DASHBOARD_URL=https://app.example.com ./scripts/verify-prod-config.sh
```

The script confirms HTTPS, `GET /health` with database probe, ingest auth (401 without API key), read auth (401 without session), CORS for the dashboard origin, and dashboard reachability. It maps to GitHub issue **#85**; retention cron, backups, and `prisma migrate deploy` remain manual in Railway.

For a full register → ingest → billing flow, use `scripts/smoke-production.sh` (issue **#87**).

---

## Related docs

| Doc | Contents |
|-----|----------|
| [docs/RAILWAY.md](docs/RAILWAY.md) | Railway services, env, cron (retention + alert-rules-evaluator), alert-webhook-worker, troubleshooting |
| [docs/BILLING.md](docs/BILLING.md) | Stripe + Resend (optional) |
| [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) | Go-live checklist |
| [docs/RELEASE.md](docs/RELEASE.md) | Tags, GitHub Releases, deploy runbook |
| [docs/ALERT-RULES.md](docs/ALERT-RULES.md) | Alert Rules conditions, SYSTEM built-ins, evaluator cron |
| [docs/ENTITLEMENTS.md](docs/ENTITLEMENTS.md) | Plans, ingest auth, rate limits |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview for contributors |
