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
| `TELEMETRY_ALLOW_REGISTRATION` | Set `false` after bootstrap if you do not want open signups |
| `SENTRY_DSN` | Optional uncaught-error reporting |

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

Do not set `NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD=true` on a public production URL.

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

**Source maps in CI:** upload `.map` files after each release with the [upload-source-maps GitHub Action](.github/actions/upload-source-maps). Set `base_api_url` to your public API URL (`API_URL` on the dashboard). Details: [docs/source-maps.md](docs/source-maps.md#github-action-workflow-example).

---

## Before going live

Use [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) for the full security and operations checklist.

---

## Related docs

| Doc | Contents |
|-----|----------|
| [docs/RAILWAY.md](docs/RAILWAY.md) | Railway services, env, cron, troubleshooting |
| [docs/BILLING.md](docs/BILLING.md) | Stripe + Resend (optional) |
| [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md) | Go-live checklist |
| [docs/RELEASE.md](docs/RELEASE.md) | Tags, GitHub Releases, deploy runbook |
| [docs/ENTITLEMENTS.md](docs/ENTITLEMENTS.md) | Plans, ingest auth, rate limits |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview for contributors |
