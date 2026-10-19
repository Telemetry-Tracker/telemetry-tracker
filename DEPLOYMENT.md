# Deployment guide

Telemetry Tracker has three runtime pieces:

1. **PostgreSQL** — database (required by the API)
2. **API** (`apps/api`) — Fastify ingest + read API (port 3001 locally; platform-assigned in production)
3. **Dashboard** (`apps/dashboard`) — Next.js UI (port 3000 locally)

The dashboard calls the API via **`API_URL`** (server-side only). The API uses **`DATABASE_URL`** for Postgres.

**Repo layout:** the root `Dockerfile` builds the **production dashboard** image, and `apps/api/Dockerfile` builds the **API** image (also used by the cron/worker services). Both use the repo root as build context. The root `docker-compose.yml` starts **Postgres only**, for local development. `selfhost/` contains the **one-command self-host stack** (Postgres + API + dashboard).

---

## Self-host with Docker Compose

Needs Docker with Compose v2.20+ and about 5 GB of free disk for the build (images plus build cache). No Node or pnpm is needed on the host.

```bash
git clone https://github.com/Telemetry-Tracker/telemetry-tracker.git
cd telemetry-tracker/selfhost
cp .env.example .env
# Fill in POSTGRES_PASSWORD, CHECKIN_ENCRYPTION_KEY and DASHBOARD_API_SECRET, e.g. each with:
openssl rand -hex 32
docker compose up -d
```

Then open `http://localhost:3000`, register (the first account can always sign up), and create an organization, a project and an API key. Point an SDK at `http://localhost:3001` (`API_PUBLIC_URL`).

What the stack does:

- **Services:** `postgres` (16-alpine), `api` (`apps/api/Dockerfile`) and `dashboard` (`selfhost/dashboard.Dockerfile`, a Next.js standalone build). The API and dashboard run as the unprivileged `node` user.
- **Migrations:** the API runs `prisma migrate deploy` on every start, before it listens. Startup is ordered with healthchecks: Postgres, then the API, then the dashboard.
- **Secrets:** none ship with the stack. `docker compose up` refuses to start until the three secrets are set in `selfhost/.env`. Keep `CHECKIN_ENCRYPTION_KEY` with your database backups.
- **Network:** Postgres has no published port and is only reachable on the internal Compose network. The API and dashboard are published on `127.0.0.1` only. Put a TLS reverse proxy in front of them, or set `BIND_ADDRESS=0.0.0.0` to listen on all interfaces over plain HTTP.
- **Public URL:** `DASHBOARD_URL` is baked into the dashboard image at build time. After changing it, run `docker compose up -d --build`.
- **Signup:** after the first account, signup is invite-only unless `TELEMETRY_ALLOW_REGISTRATION=true`.
- **Scheduled jobs (optional):** scheduled alert rules and check-ins need the evaluator, started with `docker compose --profile jobs up -d` (same API image, `--loop`). For retention, run `docker compose exec api node dist/jobs/run-retention.js` nightly from the host's cron.
- **Upgrading:** `git pull && docker compose up -d --build`. Migrations apply on start.
- **Images:** they are built locally. No prebuilt images are published yet.

### Measured: Docker Compose setup (2026-10-19)

Measured with the `selfhost/` stack at v1.22.7 plus this change, on the same test box as below: 8 vCPU (Intel Xeon), 15.6 GiB RAM, Debian 13, Docker 26.1.5 with Compose 2.26.1, on a datacenter network. The steps were scripted, so time spent reading docs is not included. These numbers come from that one setup and are not guarantees.

| Step | Cold (no images, no build cache) | Cached (images already built) |
|------|-------------------|-------------------------------|
| `git clone` | 3 s | 3 s |
| `cp .env.example .env` and set 3 secrets | under 1 s (scripted) | under 1 s |
| `docker compose up -d` returns (pull, build, start, migrate) | 221 s | 9 s |
| All three services healthy | 232 s after `up` | 12 s after `up` |
| Clone to healthy stack | 3 min 55 s | 15 s |
| Register, org, project and API key (via the API) | | 0.14 s |
| Node SDK (`@telemetry-tracker/node` 1.4.1) event visible on the dashboard Events page | | 7.5 s after the SDK started (the SDK batches events every 5 s) |

Each run started with an empty database volume. Building the two images takes most of the cold time. The cold run used a 10 s healthcheck interval. The final file probes every 2 s during startup and every 60 s once healthy.

**Idle memory and CPU** (`docker stats --no-stream` every 10 s for 5 min, starting 5 min after the last activity, 30 samples; CPU is % of one core):

| Container | Memory, median (max) | CPU, mean (max) |
|-----------|----------------------|-----------------|
| api | 77 MiB (77) | 0.00% (0.01%) |
| dashboard | 119 MiB (120) | 0.00% (0.00%) |
| postgres | 65 MiB (66) | 0.40% (3.4%) |
| **Total** | **261 MiB (262)** | **0.40% (3.4%)** |

This was the cached run with the final healthcheck settings. An earlier idle sample on the cold-run stack, with a 10 s healthcheck interval and more requests served before the sample, came to 391 MiB median (402 max), with probe-driven CPU averaging 5.8% of one core in total. `docker stats` memory excludes reclaimable page cache, so it isn't directly comparable with the RSS figures below.

Image sizes: `telemetry-tracker-api:local` 575 MB, `telemetry-tracker-dashboard:local` 357 MB and `postgres:16-alpine` 294 MB. The build cache after a cold build was 3.6 GB; reclaim it with `docker builder prune`. The Postgres volume was 51 MB after migrations and a few test events.


## Check-in monitoring requirement

Cron/background-job check-ins require the existing alert-rules evaluator every five minutes. Run `node dist/jobs/run-alert-rules-evaluator.js` on `*/5 * * * *` or use `--loop`. Set API `CHECKIN_ENCRYPTION_KEY` to 32 random bytes as hex and retain it with DB backups; set dashboard `CHECKIN_PUBLIC_BASE_URL` if `API_URL` is internal. Monitor `/health` → `alert_rules_evaluator`; the Check-ins dashboard warns when stale/never. See [check-in setup and recipes](./docs/CHECK-INS.md).


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

For all server-side dashboard API requests (including auth and affiliate applications), set **`AFFILIATE_CLIENT_IP_FORWARD_SECRET`** to the same non-empty random secret in the API and dashboard runtime environments. The dashboard sends it server-side to authenticate visitor-IP forwarding. Never use a `NEXT_PUBLIC_*` name, expose it to browsers, or log it. If it is unset or mismatched, the API ignores the forwarded IP and falls back to Railway/Cloudflare resolution; dashboard requests then share the dashboard egress IP bucket.

### API — never in production

| Variable | Why |
|----------|-----|
| `INGEST_ALLOW_UNAUTHENTICATED` | Ingest must use API keys |
| `TELEMETRY_ALLOW_UNAUTHENTICATED_READS` | Dashboard reads require login |

`RATE_LIMIT_MAX_MCP` defaults to 300 requests per minute for the pre-auth `/mcp` scope. With `trustProxy` unset, it keys on the connecting proxy address in production, so it is a coarse abuse guard shared by clients behind that proxy. Existing per-token and per-organization MCP limits remain unchanged and are the primary customer limits. Per-client IP limiting is a separate follow-up pending verification of the proxy chain; do not widen proxy trust for this guard.

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

**Sentry release (dashboard):** browser, server, and edge Sentry report `release` = `telemetry-tracker-dashboard@<version>`, where `<version>` is the newest versioned section of the repo-root `CHANGELOG.md` (same source as the API's `API_VERSION`). It is derived in `apps/dashboard/next.config.ts` at build time and inlined — no Railway variable or build arg is needed (the root `Dockerfile` already copies `CHANGELOG.md` into the build). If the version cannot be resolved, `release` is left unset (errors still report; release-health sessions need a release). Source maps are not uploaded for this release (no `SENTRY_AUTH_TOKEN` in the image build).

Declared build args: `NEXT_PUBLIC_AFFILIATES_ENABLED`, `NEXT_PUBLIC_AFFILIATE_PROGRAM_PUBLIC`, `NEXT_PUBLIC_DASHBOARD_DEBUG`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TELEMETRY_API_KEY`, `NEXT_PUBLIC_TELEMETRY_APP`, `NEXT_PUBLIC_TELEMETRY_INGEST_URL`, `NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD`.

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

### Running the API and dashboard in production

- **The API does not load `apps/api/.env` by itself at startup.** Put its variables in the real process environment (systemd `EnvironmentFile=`, your process manager, or `node --env-file=.env dist/index.js` from `apps/api` on Node 20.6+). If `NODE_ENV=production` is only in `.env`, the API skips its migrate-before-listen step. Prisma loads the rest of `.env` later, so everything else looks fine and the skip is easy to miss. Run `pnpm --filter api exec prisma migrate deploy` before starting a new version either way.
- `pnpm --filter api start` and `pnpm --filter dashboard start` keep a `pnpm` process running next to each server (about 106 MiB RSS each, measured below). Under a process manager, start the servers directly instead: `node --env-file=.env dist/index.js` in `apps/api`, and `./node_modules/.bin/next start` in `apps/dashboard` (Next.js reads the dashboard `.env` itself).

### Requirements and resource usage (measured, Node processes)

Measured on **2026-10-19** with **v1.22.6** on one test box: 8 vCPU (Intel Xeon), 15.6 GiB RAM, Debian 13, Docker 26.1.5, Node 20.19.2, pnpm 9.15.9. Postgres 16 ran via `docker-compose.yml` with default settings (`shared_buffers` 128 MB). The API and dashboard ran as host Node processes in production mode. No email, Stripe, Sentry or R2 was configured, and the alert-rules evaluator cron was not running. These are numbers from that one setup, not guarantees: your hardware, data volume and traffic will change them.

**Setup, cold caches** (command time only; Node and pnpm were already installed, and time spent reading docs is not included):

| Step | Time |
|------|------|
| `git clone` | 3 s |
| `pnpm install` (empty pnpm store, 1,034 packages) | 15 s |
| `docker compose up -d` (pulls `postgres:16`, 451 MB) until healthy | 11 s |
| `pnpm build` | 115 s |
| `prisma migrate deploy` (55 migrations) | 2 s |
| API and dashboard start until `/health` and `/` respond | 2 s |
| Register, create org, project and API key; first error ingested and listed | under 1 s (via the API) |

Clone to first error in the dashboard took 4 min 42 s of wall-clock time, done as a script. The build step dominates. Building the dashboard image with `docker build .` instead took 143 s.

**Memory and CPU.** RSS is per process and counts shared pages more than once. Postgres is container memory from `docker stats`. CPU is % of one core, sampled every 10 s.

| Process | Idle, 5 min after start (median) | Small workload (median / max) |
|---------|----------------------------------|-------------------------------|
| API (`node dist/index.js`) | 118 MiB RSS, 0% CPU | 162 / 165 MiB RSS, 5.0% / 7.8% CPU |
| Dashboard (`next-server`) | 287 MiB RSS, 0% CPU | 288 / 298 MiB RSS, 0% / 5.3% CPU |
| Postgres 16 | 49 MiB, 0% CPU (short spikes up to 4.8%) | 95 / 106 MiB, 1.1% / 13.3% CPU |
| **Total** | **453 MiB, under 1% CPU on average** | **540 MiB median, 559 MiB max; 8.6% of one core median, 17.6% max** |
| `pnpm` wrapper per `pnpm … start` (if used) | 106 MiB RSS each, 0% CPU | unchanged |

The small workload ran for 12 minutes: about 3 events/s, one error every 2 s (8 distinct errors with stack traces), one session every 10 s, and 3 authenticated dashboard page loads every 30 s. That came to 2,160 events, 360 errors and 72 sessions. Every request got a 204, and ingest latency was 12.5 ms p50 / 16.7 ms p95. Afterwards the database was 13 MB and the Postgres volume 71 MB. In a second idle run after the workload, with the servers started directly (no `pnpm` wrapper), the total was 490 MiB (API 121 MiB, dashboard 291 MiB, Postgres 78 MiB).

Image sizes: `postgres:16` 451 MB. The dashboard image from the root `Dockerfile` was 1.06 GB after [#826](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/826) (2.35 GB before).

---

## Where to deploy

| Target | Guide |
|--------|--------|
| **Railway** (recommended PaaS) | [docs/RAILWAY.md](docs/RAILWAY.md) — Postgres, API, dashboard, cron, troubleshooting |
| **Single VPS** | Postgres + API + dashboard on one host; reverse proxy (Nginx/Caddy) for HTTPS |
| **Docker Compose (self-host)** | [`selfhost/`](#self-host-with-docker-compose): Postgres + API + dashboard with one `docker compose up -d` |
| **Local dev** | Postgres only, via `docker compose up -d` in the repo root |

For a single host, use the [Docker Compose stack](#self-host-with-docker-compose). Railway and a VPS with a process manager are covered below.

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

### Read-only MCP agent access

MCP is off by default, including hosted deployments. Apply the additive
`20261012000000_mcp_read_tokens` migration before opting in with
`TELEMETRY_MCP_ENABLED=true` on the API. Keep `TELEMETRY_INGEST_PII_SCRUB` enabled;
MCP refuses access when it is disabled. Set `DASHBOARD_URL` to the dashboard origin.
Setup and security documentation: `/docs/mcp`.

MCP uses PostgreSQL buckets per token and org (Free: 30/120 requests/minute;
paid: 120/600), shared across replicas. It does not use forwarded IP headers.
Fastify currently has no `trustProxy` setting and the existing Fastify rate limiter
uses its default `request.ip` key. If Railway presents a proxy source address,
clients may share the existing API/auth/ingest/public IP buckets. This is a
code-supported deployment concern, not a confirmed observation of production.
Do not enable unconditional proxy trust: verify Railway's forwarding and trusted
hop boundary before changing the existing limiter. This requires operator follow-up
and blocks a release decision until resolved. MCP's token/org quotas are independent.

Token expiry is enforced on every request; its audit event is recorded once at
first authenticated observation after expiry. Rate rows are fixed per org/token,
not per request. Remove obsolete `McpRateBucket` rows when hard-deleting orgs/users
if necessary; do not remove active buckets during the current minute.

TODO(legal): review the neutral customer-selected AI export wording in `/docs/mcp`.
No claim is made that existing privacy policy or DPA terms cover this processing.

### Client IP resolution and rate limits

On Railway, set `TRUST_RAILWAY_EDGE=true` (also the production default). Railway must overwrite `X-Real-IP` at its edge, and the API must only be reachable through that edge. For other hosting, set it to `false`: the socket peer is the base hop. Fastify global `trustProxy` stays unset. Invalid or multi-value `X-Real-IP` falls back to the socket IP. Only when the base hop belongs to Cloudflare's published IPv4/IPv6 networks do we accept a single valid `CF-Connecting-IP`; direct-to-Railway callers cannot spoof that identity. `X-Forwarded-For` and `X-Envoy-*` never determine identity. Embedded Cloudflare ranges were verified on 2026-10-12; review them against https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 when Cloudflare updates its networks.

All API rate-limit scopes share this resolver. Existing limits stay unchanged (auth 30/min, API/public/MCP pre-auth 300/min, ingest 3000/min, affiliate applications 5/10min). Ingest keys combine the resolved IP with the API key public ID parsed from `Authorization: Bearer` or `X-API-Key`, so distinct keys/projects behind one NAT have separate buckets without a database lookup. Missing/malformed keys share the IP-only bucket. This pre-auth partition is not authentication; existing key validation and project plan limits still apply. Authenticated dashboard visitor forwarding takes precedence in every scope using the existing `AFFILIATE_CLIENT_IP_FORWARD_SECRET`; invalid/missing credentials fall back to the shared proxy resolver. Dashboard server fetches derive the visitor from Railway X-Real-IP, accepting CF-Connecting-IP only from Cloudflare peers and never XFF. Keep the API and dashboard embedded ranges synchronized (covered by a parity test).

For temporary diagnosis, set `IP_DIAGNOSTIC_LOG=true`. Each request emits one info record containing only socket IP, `X-Real-IP`, `X-Forwarded-For`, `CF-Connecting-IP`, `X-Envoy-External-Address`, resolved IP, and source (`dashboard`, `cf`, `railway`, or `socket`). It is off by default; disable after diagnosis to avoid retaining unnecessary IP data. Authorization, API keys and forwarding secrets are excluded.
