# Railway deployment

Deploy **Postgres + API + dashboard** as separate Railway services. Core env vars: [DEPLOYMENT.md](../DEPLOYMENT.md).

**Do not** add a repo-root `railway.toml` that sets `builder = "DOCKERFILE"` for every service — that forces the dashboard Dockerfile onto the API and breaks the build.

---

## Services

| Service | Root directory | Builder |
|---------|----------------|---------|
| **PostgreSQL** | — | Railway Postgres |
| **API** | `apps/api` | **Railpack** (default Node) — **not** Dockerfile |
| **Dashboard** | **empty** (repo root) | **Dockerfile** (repo root) — **only on this service** |
| **Retention cron** (optional) | `apps/api` | Cron job |

---

## PostgreSQL

1. Create a PostgreSQL service in your Railway project.
2. Copy **`DATABASE_URL`** to the API (and cron) service — prefer the **internal** URL when services are in the same project.

---

## API service

| Setting | Value |
|---------|--------|
| Root Directory | `apps/api` |
| Build | `npm install` → `npm run build` |
| Start | `npm run start` (`node dist/index.js`) |
| Watch Paths (optional) | `apps/api/**` |

**Env (minimum):** `DATABASE_URL`, `NODE_ENV=production`, `HOST=0.0.0.0`, `HEALTH_CHECK_DATABASE=true`, `CORS_ORIGINS` or `DASHBOARD_ORIGIN`, `TELEMETRY_DASHBOARD_ORIGIN`.

Railway sets **`PORT`** (usually **8080**). When adding a custom domain, set the **public target port to 8080** in **Settings → Networking**.

**Migrations** (once after first deploy, from your machine or a one-off shell):

```bash
DATABASE_URL="postgresql://..." pnpm --filter api exec prisma migrate deploy
```

Optional: Resend, Stripe, registration flags — [BILLING.md](./BILLING.md) and [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md).

**Resend (API service only):** set `RESEND_API_KEY`, `TELEMETRY_EMAIL_FROM`, and optionally `CONTACT_INBOX_EMAIL`. After deploy, `GET /health` should include `"email":"configured"`. Full DNS and verification steps: [BILLING.md → Production setup](./BILLING.md#production-setup-hosted-cloud).

**Monitoring:** optional `SENTRY_DSN` on the API; optional `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` on the dashboard; external uptime via [MONITORING.md](./MONITORING.md) and [`.github/workflows/production-uptime.yml`](../.github/workflows/production-uptime.yml).

---

## Dashboard service

| Setting | Value |
|---------|--------|
| Root Directory | **empty** (repo root — not `apps/dashboard`) |
| Builder | **Dockerfile**, path `Dockerfile` |
| Watch Paths (optional) | `apps/dashboard/**` |

**Env:** `API_URL` = public API URL; `NEXT_PUBLIC_SITE_URL` = public dashboard URL (recommended). Optional: `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value) for error monitoring — see [MONITORING.md](./MONITORING.md#sentry-optional).

If the build fails with `Unsupported URL Type "workspace:"`, Railway is using npm/Nixpacks instead of Docker — clear Root Directory to repo root and set Builder to Dockerfile on **this service only**.

---

## Retention cron

Nightly retention prevents telemetry from growing unbounded. The job is implemented in `apps/api/src/jobs/run-retention.ts` and must run on a schedule in each production environment.

### Railway setup (manual)

Railway cron is configured per service in the dashboard — it cannot be declared in a repo-root `railway.toml` without affecting other services.

1. In your Railway project, click **+ New** → **Empty Service** (name it e.g. `retention-cron`).
2. **Settings → Source** → **Root Directory** = `apps/api`.
3. **Settings → Build** → leave **Railpack** (default Node builder), same as the API service.
4. **Settings → Deploy** → **Start Command** = `node dist/jobs/run-retention.js`
   - Use `node …` directly, **not** `npm run retention`. Package managers can intercept exit signals and leave the cron container running; Railway skips the next run if a previous one is still active.
5. **Settings → Cron Schedule** = `0 3 * * *` (03:00 UTC daily).
6. **Variables** → add **`DATABASE_URL`** (same value as the API — use **Reference** from the Postgres service or copy the internal URL).
7. Deploy once, then use **Run now** (or wait for the schedule) and confirm logs show JSON like:

   ```json
   {"ok":true,"dryRun":false,"projectsProcessed":1,"errorOccurrencesDeleted":0,"eventsDeleted":0,"sessionsDeleted":0,"errorGroupsDeleted":0,"sourceMapsDeleted":0,"at":"2026-07-09T03:00:01.234Z"}
   ```

8. Confirm the deployment **exits** after the log line (status returns to inactive). If it stays running, fix the start command or unclosed DB handles before relying on the schedule.

| Setting | Value |
|---------|--------|
| Root Directory | `apps/api` |
| Start command | `node dist/jobs/run-retention.js` |
| Cron schedule | `0 3 * * *` (03:00 UTC daily) |
| `DATABASE_URL` | Same as API |

### Local verification

With Postgres running (`docker compose up -d`) and migrations applied:

```bash
pnpm --filter api retention -- --dry-run   # count only, no deletes
pnpm --filter api retention                # live sweep (dev DB)
```

After `pnpm --filter api build`, production entrypoint: `node dist/jobs/run-retention.js`.

---

## PostgreSQL backups and restore

Hosted telemetry must be recoverable if the database is lost or corrupted.

### Confirm backups (Railway dashboard)

1. Open your **PostgreSQL** service → **Backups** tab.
2. Confirm automated backups are enabled for your plan (Railway’s native **Backups** feature).
3. Optional but recommended for production: enable **Point-in-Time Recovery (PITR)** if available on your plan — see [Railway PITR docs](https://docs.railway.com/volumes/point-in-time-recovery). PITR must be enabled **before** an incident; the restore window only covers history after activation.
4. Note the backup / PITR retention window shown in the dashboard.

### Restore options

| Scenario | Approach |
|----------|----------|
| **Recent mistake** (drop table, bad migration) | **PITR** (if enabled): Backups tab → pick target timestamp → Railway provisions a **new** Postgres service with data restored to that moment. Update `DATABASE_URL` on API, cron, and any tools to point at the restored service (or copy data back manually). |
| **Volume snapshot** | Postgres service → **Volumes** → **Snapshots** → restore to a new service. Same connection-string swap as PITR. |
| **Off-platform copy** (compliance, DR) | Periodic logical dump from your machine or CI using `pg_dump` against the TCP proxy URL. Store dumps encrypted outside Railway. |

### Manual off-platform backup (pg_dump)

Requires `psql` / `pg_dump` locally and the Postgres **TCP proxy** enabled (Settings → Networking).

```bash
# Custom format (recommended for pg_restore)
pg_dump "$DATABASE_URL" -Fc -f telemetry-$(date +%Y%m%d).dump

# Plain SQL (portable)
pg_dump "$DATABASE_URL" -f telemetry-$(date +%Y%m%d).sql
```

Restore to a **new empty** database (never overwrite production in place without a maintenance window):

```bash
createdb telemetry_restored   # or create via Railway + new service
pg_restore -d "$RESTORE_DATABASE_URL" --no-owner --no-acl telemetry-YYYYMMDD.dump
# Prisma: pnpm --filter api exec prisma migrate deploy  # if schema drift
```

Prisma may log warnings during restore; data import usually succeeds. Verify row counts and run `GET /health` on the API after pointing at a restored database.

### Restore drill (recommended once before launch)

1. Take a `pg_dump` or note the latest PITR timestamp.
2. Restore to a **separate** Railway Postgres service (or local Postgres).
3. Point a local API at the restored `DATABASE_URL` and confirm login + overview data.
4. Document who can perform restores and where connection strings live (secret manager / Railway variables).

See also [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) and GitHub issue **#86** launch checklist.

---

## Troubleshooting

### API: Docker build fails — `eslint.config.mjs` not found

The API service is using the **dashboard Dockerfile** or a repo-root Docker setting.

**Fix:** API → **Build** → **Builder** = **Railpack** (not Dockerfile). **Root Directory** = `apps/api`. Redeploy.

### Dashboard: `EUNSUPPORTEDPROTOCOL` / `workspace:`

Root Directory is `apps/dashboard` and npm cannot resolve pnpm workspaces.

**Fix:** Dashboard → **Root Directory** = **empty** (repo root) → **Builder** = **Dockerfile** → redeploy.

### API: 502 / connection refused

Deploy logs show `Listening on 0.0.0.0:8080` but the domain still 502s.

1. **Networking / domain port** → set target port **8080** (matches Railway `PORT`).
2. Check runtime logs for startup crashes (`DATABASE_URL`, Prisma errors).
3. Set **`HOST=0.0.0.0`** if needed and redeploy.

---

## Other PaaS (Render, Fly, etc.)

Same three pieces: managed Postgres, API from `apps/api`, dashboard from repo root Dockerfile or a monorepo-aware build. Set the same env vars as above. If the platform cannot build pnpm workspaces, build in CI and deploy artifacts.

See also [RELEASE.md](./RELEASE.md) for the maintainer deploy runbook and post-deploy verification.
