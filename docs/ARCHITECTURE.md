# Architecture overview

High-level map of **Telemetry Tracker** for contributors. For RBAC details see [RBAC.md](./RBAC.md); for orgs, keys, and plan limits see [ENTITLEMENTS.md](./ENTITLEMENTS.md).

---

## System diagram

```
┌─────────────────┐     ingest (API key)      ┌──────────────┐
│  Client apps    │ ─────────────────────────▶│              │
│  @telemetry-tracker/*                         │   Fastify    │
└─────────────────┘                           │   API        │
                                              │  apps/api    │
┌─────────────────┐     read (session)        │              │
│  Next.js        │ ◀────────────────────────▶│              │
│  dashboard      │                           └──────┬───────┘
└─────────────────┘                                  │
                                                     │ Prisma
                                                     ▼
                                              ┌──────────────┐
                                              │  PostgreSQL  │
                                              └──────────────┘
```

- **Ingest** (SDKs → API): authenticated with **project API keys** (`tt_live_…`).
- **Dashboard** (browser → API): authenticated with **user sessions** (email/password); the UI never talks to Postgres directly.
- **Retention cron**: scheduled job runs `run-retention.ts` against the same database (see [RAILWAY.md](./RAILWAY.md#retention-cron)).

---

## Monorepo layout

| Path | Role |
|------|------|
| `apps/api` | Fastify server — ingest, read API, auth, org/project meta, optional Stripe billing |
| `apps/dashboard` | Next.js App Router UI — overview, errors, events, sessions, settings |
| `packages/telemetry-core` | Shared SDK (`init`, `trackEvent`, `trackError`, batching, anonymous id) |
| `packages/telemetry-next` | Next.js provider, error boundary, page tracking |
| `packages/telemetry-node` | Node global handlers, optional middleware |
| `packages/telemetry-react-native` | RN global error handler, screen tracking |

Published on npm as `@telemetry-tracker/*`. Workspace tooling: **pnpm**, root `eslint.config.mjs`, shared TypeScript.

---

## Multi-tenant model

```
Organization (billing owner, plan tier)
    └── Project (telemetry namespace)
            ├── ApiKey(s)  → ingest auth
            ├── Event / Session / ErrorGroup / ErrorOccurrence
            └── UsageMonthly (ingest unit meter)
```

- **Organization** — Stripe customer/subscription optional; soft-delete via `deleted_at`.
- **Project** — all telemetry rows are scoped by `project_id`; slug unique per org.
- **User** — dashboard login only; linked to orgs through **OrganizationMembership** (`OWNER` / `EDITOR` / `VIEWER`).
- Self-serve registration creates a user **without** an org; they create one via `POST /api/meta/organizations` or join via invite.

---

## Two authentication paths

### 1. Ingest (SDKs and server clients)

| Step | Location |
|------|----------|
| Parse `Authorization: Bearer tt_live_<publicId>_<secret>` or `X-API-Key` | `apps/api/src/lib/api-key-auth.ts` |
| Verify hash, expiry, revocation, org/project not deleted | same |
| Attach `projectId` on request | `apps/api/src/middleware/ingest-auth.ts` |
| Enforce plan limits + usage meter | `apps/api/src/lib/plan-enforcement.ts`, `usage-meter.ts` |

Production must **not** use `INGEST_ALLOW_UNAUTHENTICATED`. Dev-only fallback: env `TELEMETRY_PROJECT_ID`.

Optional **per-app keys**: if `ApiKey.allowed_app` is set, JSON `app` must match.

### 2. Dashboard reads and mutations

| Step | Location |
|------|----------|
| Login → session token | `apps/api/src/routes/auth.ts`, `auth-session.ts` |
| Dashboard sends `Authorization: Bearer <session>` + `X-Project-Id` (+ optional `X-Organization-Id`) | `apps/dashboard/lib/dashboard-api.ts` |
| Resolve project + org membership | `apps/api/src/lib/read-project-request.ts` |
| Enforce RBAC on mutations | route handlers + `session-context` |

In **production**, `GET /api/*` telemetry reads require a session. Legacy unauthenticated reads exist for local tooling only (`TELEMETRY_ALLOW_UNAUTHENTICATED_READS`).

---

## Ingest pipeline

Routes under **`/ingest/*`** (`apps/api/src/routes/ingest.ts`):

| Endpoint | Purpose |
|----------|---------|
| `POST /ingest/event` | Custom product/analytics events |
| `POST /ingest/error` | Errors (grouped by fingerprint) |
| `POST /ingest/session` | Session start/end |
| `POST /ingest/batch` | Batched events |

Each accepted payload increments **ingest units** for the project’s current UTC month (`UsageMonthly`). Errors are deduplicated into **ErrorGroup** + **ErrorOccurrence** rows (`apps/api/src/services/errors.ts`).

---

## Read API (dashboard)

Routes under **`/api/*`** (`apps/api/src/routes/api.ts`, `project-dashboard.ts`):

- Overview time series, error list/detail, events, sessions
- Org/project/API key management under `/api/meta/*` and `/api/project/*`
- `GET /api/meta/session-context` — role, capabilities, usage quota for the active project

The dashboard is mostly **React Server Components** that call the API with `dashboardApiFetch` (server-side only). Project/org selection is stored in cookies and resolved in `apps/dashboard/lib/dashboard-workspace-request.ts`.

---

## API application structure

Entry: `apps/api/src/index.ts` → `createApp()` in `app.ts`.

| Mount | Routes | Notes |
|-------|--------|-------|
| `/health`, `/` | public | optional DB check; returns `version`, optional DB latency and detailed mode |
| `/ingest` | ingest | API key auth, ingest rate limit |
| `/api/auth` | auth | register, login, logout, password reset |
| `/api` | api + project-dashboard | session + project scope |
| `/webhooks/stripe` | stripe-webhook | raw body, if Stripe configured |

Cross-cutting: CORS (`cors-config.ts`), rate limits per surface (`rate-limit-env.ts`), 200 KB body limit, optional Sentry.

---

## Database

- **ORM:** Prisma — schema in `apps/api/prisma/schema.prisma`, migrations in `apps/api/prisma/migrations/`.
- **Local migrations:** `pnpm db:migrate` (can create new migration files).
- **Production:** `pnpm --filter api exec prisma migrate deploy` only.

Core telemetry tables: `Event`, `Session`, `ErrorGroup`, `ErrorOccurrence` — all include `project_id`.

---

## SDK packages

All SDKs depend on **`@telemetry-tracker/core`** for HTTP ingest:

1. `init({ ingestUrl, app, apiKey, … })`
2. `trackEvent` / `trackError` / `screen` / `identify`
3. Optional batching (default flush interval 5s)
4. Browser: `window.onerror` + `unhandledrejection` after `init()`

Framework packages add ergonomics (Next.js provider, Node process handlers, RN screen helper). Platform guides: `docs/sdk-*.md` and `/docs/*` on the dashboard (Next.js, Node, NestJS, Nuxt, Vue, React Native).

---

## Background jobs

| Job | Command | Purpose |
|-----|---------|---------|
| Retention sweep | `node dist/jobs/run-retention.js` | Delete telemetry older than plan `retentionDays` per project |

Implementation: `apps/api/src/jobs/retention.ts`. Open sessions without `ended_at` are not pruned until closed (known limitation).

---

## Deployment (summary)

| Component | Typical hosting |
|-----------|-----------------|
| Postgres | Managed DB (Railway, RDS, etc.) |
| API | Node process (`apps/api`, Railpack on Railway) |
| Dashboard | Root `Dockerfile` (monorepo build) or `pnpm start` |
| Cron | Retention job on a schedule |

Details: [DEPLOYMENT.md](../DEPLOYMENT.md), [RAILWAY.md](./RAILWAY.md), [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md).

---

## Where to start as a contributor

| Task | Start here |
|------|------------|
| Ingest or plan limits | `apps/api/src/routes/ingest.ts`, `config/plans.ts` |
| Dashboard UI | `apps/dashboard/app/dashboard/` |
| Auth / RBAC | `apps/api/src/routes/auth.ts`, [RBAC.md](./RBAC.md) |
| SDK behavior | `packages/telemetry-core/src/index.ts` |
| Tests | `apps/api/src/**/*.test.ts`, `*.integration.test.ts` (set `RUN_DB_INTEGRATION_TESTS=true`) |

See [CONTRIBUTING.md](../CONTRIBUTING.md) and [good first issues](https://github.com/Telemetry-Tracker/telemetry-tracker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
