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

For affiliate applications, set **`AFFILIATE_CLIENT_IP_FORWARD_SECRET`** to the same non-empty random secret in the API and dashboard runtime environments. The dashboard sends it server-side to authenticate visitor-IP forwarding. Never use a `NEXT_PUBLIC_*` name, expose it to browsers, or log it. If it is unset or mismatched, the API ignores the forwarded IP and rate-limits by `request.ip`; dashboard submissions then share the dashboard connection IP limit.

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

All API rate-limit scopes share this resolver. Existing limits stay unchanged (auth 30/min, API/public/MCP pre-auth 300/min, ingest 3000/min, affiliate applications 5/10min). Ingest keys combine the resolved IP with the API key public ID parsed from `Authorization: Bearer` or `X-API-Key`, so distinct keys/projects behind one NAT have separate buckets without a database lookup. Missing/malformed keys share the IP-only bucket. This pre-auth partition is not authentication; existing key validation and project plan limits still apply. Affiliate applications still prefer visitor IP forwarding authenticated with `AFFILIATE_CLIENT_IP_FORWARD_SECRET`, falling back to the shared resolver.

For temporary diagnosis, set `IP_DIAGNOSTIC_LOG=true`. Each request emits one info record containing only socket IP, `X-Real-IP`, `X-Forwarded-For`, `CF-Connecting-IP`, `X-Envoy-External-Address`, resolved IP, and source (`cf`, `railway`, or `socket`). It is off by default; disable after diagnosis to avoid retaining unnecessary IP data. Authorization, API keys and forwarding secrets are excluded.
