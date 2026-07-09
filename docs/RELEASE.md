# Release and deployment process

This document describes how we integrate, release, and deploy **Telemetry Tracker** (API + dashboard). SDK packages (`@telemetry-tracker/*`) use separate semver in `packages/*/package.json` and `pnpm publish:packages` — see [README](../README.md#publishing-sdk-packages-to-npm).

User-facing changes are recorded in [CHANGELOG.md](../CHANGELOG.md).

---

## Branch model

| Branch | Role |
|--------|------|
| **`develop`** | Integration branch — **GitHub default**; feature PRs merge here; CI must pass |
| **`main`** | Production — official hosted cloud and semver GitHub Releases |
| **`feature/*`, `fix/*`** | Short-lived; open PRs against **`develop`** |

```mermaid
flowchart LR
  Feature[feature/fix branch]
  Develop[develop]
  Main[main]
  Hosted[Railway production]
  Tag[GitHub Release vX.Y.Z]
  Feature -->|PR| Develop
  Develop -->|milestone release PR| Main
  Main --> Hosted
  Main --> Tag
```

**Deploy ≠ release.** Railway production deploys from **`main`**. Self-hosters and GitHub Release consumers follow **semver tags** on `main`.

There is no separate staging deploy yet — validate on `develop` locally before milestone promotion.

### `develop` merge gate

Feature and fix PRs merge into **`develop`**. Branch protection (Settings → Branches → `develop`):

| Rule | Mechanism |
|------|-----------|
| PR required | Branch protection — no direct pushes to `develop` |
| CI must pass | Required status check: `build` ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) |
| Bugbot | Required status check: `Cursor Bugbot` — see [CONTRIBUTING.md](../CONTRIBUTING.md#ai-code-review-bugbot) |
| Branch up to date | Require branches to be up to date before merging |
| Human approvals | **0** — GitHub cannot require “approval only when author ≠ maintainer”; use `maintainer-review` check instead |
| Maintainer gate | Required status check: `maintainer-review` — passes automatically when PR author is @unjica; otherwise requires your APPROVED review |

**GitHub settings (required):** On the `develop` rule, set **Required approvals to 0** and add **`maintainer-review`** to required status checks (with `build` and `Cursor Bugbot`). Do not rely on “1 approval” for solo PRs — authors cannot approve their own PRs.

**Your own PRs to `develop`:** `maintainer-review` passes automatically after CI + Bugbot are green.

**Adding status checks:** GitHub lists checks only after they have run at least once on a PR. Open or update a PR, wait for `build`, `Cursor Bugbot`, and `maintainer-review` to finish, then edit the `develop` rule if a check is missing.

Bugbot findings default to a **`neutral`** check conclusion — they comment but do not block merge unless **fail on unresolved issues** is enabled in the Cursor Bugbot dashboard.

### `main` merge gate

GitHub cannot require “your approval only when you are not the PR author” (authors cannot approve their own PRs). **`main`** uses:

| Rule | Mechanism |
|------|-----------|
| PR required | Branch protection |
| CI must pass | Required check: `build` |
| Bugbot (recommended) | Optional required check: `Cursor Bugbot` — see [CONTRIBUTING.md](../CONTRIBUTING.md#ai-code-review-bugbot) |
| **Maintainer approval when author ≠ @unjica** | Required check: `maintainer-review` ([workflow](../.github/workflows/maintainer-review.yml)) |
| **Your own PRs to `main`** | `maintainer-review` passes automatically; merge after `build` is green |
| Review requests | [CODEOWNERS](../.github/CODEOWNERS) notifies @unjica on PRs to `main` |

After the maintainer-review workflow is on **`main`**, add `maintainer-review` to required status checks (Settings → Branches → `main`, or maintainer API update).

---

## Release cadence

Releases are **milestone-driven**:

1. Track work in a GitHub milestone (e.g. “v1.2 — …”).
2. Merge completed work into **`develop`**; keep [CHANGELOG.md](../CHANGELOG.md) `[Unreleased]` up to date.
3. When the milestone is complete and CI is green, promote **`develop` → `main`** (release PR or fast-forward).
4. Tag **`main`**, publish GitHub Release, migrate production DB, verify deploy.
5. **Sync `develop` with `main`** — always merge `main` back into `develop` after promotion (see [checklist](#on-main-after-promotion)). Squash merges, merge commits, and post-promotion commits on `main` (e.g. CHANGELOG finalization) leave `develop` behind otherwise.

**Hotfixes** on production: branch from **`main`**, fix, merge to **`main`**, tag a **patch** version, then merge **`main` → `develop`** so branches stay aligned. Assign PRs and release PRs to a milestone per [Milestones vs hotfixes](#milestones-vs-hotfixes-audit-trail).

---

## Milestones vs hotfixes (audit trail)

**Milestone-driven releases** (typical **MINOR** / **MAJOR** promotion) follow the cadence above: scope work in a GitHub milestone, merge into `develop`, then promote `develop` → `main`.

**PATCH releases** (production hotfixes, docs-only promotions, and other small semver bumps on `main`) use the same promote → tag → GitHub Release → sync `develop` flow, but they are not required to open a new product milestone for every patch.

For **audit trail**, PATCH and docs hotfixes **should** still:

1. Assign the integrating PR(s) on `develop` to a milestone — typically the **active patch-line milestone** (e.g. `v1.4.x — Platform releases`).
2. Assign the **`develop` → `main` release PR** to that same milestone.
3. Update the milestone **description** with the shipped semver (e.g. **v1.4.3**, **v1.4.4**) when the release completes.

If the patch-line milestone is **closed**, you may still assign merged PRs to it retroactively, or open a new patch-line milestone if you prefer a clean bucket for the next patches.

Product update emails remain policy-driven ([MARKETING-EMAIL.md](./MARKETING-EMAIL.md)); docs-only PATCH releases usually **skip** subscriber email.

---

## Versioning

| Artifact | Version | Tag / registry |
|----------|---------|----------------|
| **App** (API + dashboard) | Semver on `main` | `v1.0.0`, `v1.1.0`, … |
| **SDKs** | Per-package in `packages/*/package.json` | npm (`pnpm publish:packages`) |

### Semver guidance

App releases use **`vX.Y.Z`**:

| Component | Bump name | When |
|-----------|-----------|------|
| **X** | **MAJOR** | Breaking ingest/HTTP contract, auth model, required env vars, destructive migrations |
| **Y** | **MINOR** | Features, backward-compatible migrations, dashboard UX (typical milestone release) |
| **Z** | **PATCH** | Bug fixes and hotfixes on `main` |

Product update emails (see [MARKETING-EMAIL.md](./MARKETING-EMAIL.md#when-to-send-maintainer-policy)) send on **X** or **Y** increases; **Z**-only hotfixes do not.

Always document **migrations**, **new env vars**, and **breaking changes** in CHANGELOG and the GitHub Release notes.

---

## Release checklist (maintainers)

### Before promoting `develop` → `main`

- [ ] GitHub milestone complete (or release scope agreed)
- [ ] [CHANGELOG.md](../CHANGELOG.md) `[Unreleased]` section complete
- [ ] CI green on `develop` (`pnpm lint`, `pnpm test`, `pnpm -r run build`)
- [ ] Self-host upgrade notes ready (migrations, env vars)
- [ ] If this is a **MINOR** (Y) or **MAJOR** (X) release: confirm `CHANGELOG.md` is ready and plan to run [production migrations](#3-database-migrations-production) **before** pushing the tag — [product update email](./MARKETING-EMAIL.md#automated-send-minor--major-tags) sends automatically when the tag is pushed

### On `main` after promotion

1. **Finalize CHANGELOG** — rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`. Prefer doing this in the **`develop` → `main`** release PR so `develop` and `main` stay aligned; if you commit on `main` after promotion, you **must** sync `develop` in step 9.
2. **Deploy** — Railway rebuilds `main` automatically when the release PR merges; see [Deploy runbook](#deploy-runbook-railway).
3. **Production DB** — run [migrations](#3-database-migrations-production) **before tagging** on MINOR (Y) / MAJOR (X) releases. The release email workflow reads production Postgres but does not migrate (use the public `DATABASE_URL` in GitHub secrets — see [MARKETING-EMAIL.md](./MARKETING-EMAIL.md#automated-send-minor--major-tags)).
4. **Post-deploy** — [verification](#post-deploy-verification).
5. **Tag** — after deploy and migrations are green (tag push triggers the product update email workflow for MINOR/MAJOR — **X** or **Y** bump, not Z-only hotfixes):
   ```bash
   git checkout main && git pull origin main
   git tag -a v1.1.0 -m "Telemetry Tracker v1.1.0"
   git push origin v1.1.0
   ```
6. **GitHub Release** — publish notes from [RELEASE_NOTES_TEMPLATE.md](./RELEASE_NOTES_TEMPLATE.md) (highlights + upgrade steps; link to CHANGELOG for detail):
   ```bash
   VERSION=1.2.0
   PREVIOUS=1.1.0
   cp docs/RELEASE_NOTES_TEMPLATE.md /tmp/release-notes-v${VERSION}.md
   # Edit: Highlights from CHANGELOG [X.Y.Z]; migrations since tag v${PREVIOUS}; env/SDK sections if needed
   gh release create "v${VERSION}" \
     --title "Telemetry Tracker v${VERSION}" \
     --notes-file "/tmp/release-notes-v${VERSION}.md"
   ```
   See the template for section guidance and a filled v1.1.0 example. Do not duplicate the entire CHANGELOG — keep the release body scannable for deployers.
7. **SDK** — if ingest/SDK contract changed, bump `packages/*/package.json` and `pnpm publish:packages`.
8. **Product update email** — **MINOR** (Y) and **MAJOR** (X) tags trigger the [Release product email](../.github/workflows/release-email.yml) workflow automatically (Z-only patch/hotfix tags skipped). Ensure repository secrets are set ([MARKETING-EMAIL.md](./MARKETING-EMAIL.md#automated-send-minor--major-tags)). After the workflow completes, note send date and recipient count in the GitHub Release. For notable PATCH (Z) releases or backfill, send manually with `--force` — see [MARKETING-EMAIL.md](./MARKETING-EMAIL.md#manual-send-override--backfill).
9. **Sync `develop`** — merge **`main` into `develop`** and push after every release (milestone promotion or hotfix). Required whenever `main` has commits not on `develop` — including squash merges, merge commits from the release PR, and any post-promotion edits on `main`:
   ```bash
   git checkout develop && git pull origin develop
   git merge origin/main
   git push origin develop
   ```

---

## Deploy runbook (Railway)

Production uses **three Railway services** (+ optional Cron):

| Service | Root directory | Builder |
|---------|----------------|---------|
| PostgreSQL | — | Railway Postgres |
| API | `apps/api` | Railpack (not Dockerfile) |
| Dashboard | repo root (empty) | Dockerfile |
| Retention cron (optional) | `apps/api` | Cron → `pnpm exec tsx src/jobs/run-retention.ts` |

### 1. Trigger deploy

- **Automatic:** push/merge to **`main`**. Each service rebuilds when its watch paths change.
- **Manual:** Railway dashboard → service → **Redeploy**.

### 2. CI gate (GitHub)

On push and pull requests to **`develop`** and **`main`**, CI runs ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):

- `pnpm lint`
- `prisma migrate deploy` (against CI Postgres only)
- `pnpm test` with `RUN_DB_INTEGRATION_TESTS=true`
- `pnpm -r run build`
- telemetry-core dist drift check

**Do not promote to `main`, tag, or deploy production if CI is failing.**

### 3. Database migrations (production)

CI does **not** migrate your production database during normal builds. Apply migrations after API deploy and **before pushing a MINOR (Y) / MAJOR (X) tag** (see [On `main` after promotion](#on-main-after-promotion)). The [Release product email](../.github/workflows/release-email.yml) workflow connects to production Postgres for the send ledger only — use Railway’s **public** database URL in GitHub secrets, not `postgres.railway.internal`.

```bash
DATABASE_URL="postgresql://..." pnpm --filter api exec prisma migrate deploy
```

Use Railway Postgres **public** URL from your laptop, or a Railway one-off shell with `DATABASE_URL` set.

Alternatively, add to the API **start command** (only if you accept migrate-on-every-start):

```bash
pnpm exec prisma migrate deploy && node dist/index.js
```

Prefer one-off or deploy hook if you want explicit control.

### 4. Environment variables

Set on **each Railway service** (not only a local `.env`). Core vars: [DEPLOYMENT.md](../DEPLOYMENT.md). Email & Stripe: [BILLING.md](./BILLING.md). Railway setup: [RAILWAY.md](./RAILWAY.md).

**API (required in production):**

- `DATABASE_URL`, `NODE_ENV=production`, `HOST=0.0.0.0`
- `HEALTH_CHECK_DATABASE=true`
- `CORS_ORIGINS` or `DASHBOARD_ORIGIN` = dashboard URL
- `TELEMETRY_DASHBOARD_ORIGIN` = dashboard URL (no trailing slash)

**API (recommended):**

- `RESEND_API_KEY`, `TELEMETRY_EMAIL_FROM` — invites, password reset, notification email
- `TELEMETRY_ALLOW_REGISTRATION=false` — after first user exists

**API (never in production):**

- `INGEST_ALLOW_UNAUTHENTICATED`
- `TELEMETRY_ALLOW_UNAUTHENTICATED_READS`

**Dashboard:**

- `API_URL` = public API URL (no trailing slash)
- `NEXT_PUBLIC_SITE_URL` = public dashboard URL

### 5. Retention cron

Schedule nightly (e.g. `0 3 * * *` UTC):

```bash
node dist/jobs/run-retention.js
```

Same `DATABASE_URL` as the API. See [RAILWAY.md](./RAILWAY.md#retention-cron).

---

## Post-deploy verification

```bash
./scripts/verify-prod-config.sh
# Custom hosts: VERIFY_API_URL=... VERIFY_DASHBOARD_URL=... ./scripts/verify-prod-config.sh
```

Or individual curls:

```bash
curl -sS https://<api-host>/health
# → {"ok":true,"version":"1.6.2","database":"ok","database_latency_ms":5,"email":"configured"}

curl -sS -o /dev/null -w "%{http_code}" -X POST https://<api-host>/ingest/event \
  -H "Content-Type: application/json" -d '{"app":"t","name":"t"}'
# → 401

curl -sS -o /dev/null -w "%{http_code}" https://<api-host>/api/errors
# → 401
```

In the browser:

- Dashboard loads; `/dashboard` redirects to login when logged out
- Register (if allowed) → org → project → API key → ingest → Overview shows data
- Notifications bell and Appearance theme (v1.1+)

See also [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md).

---

## Bootstrap (first production install)

1. Deploy Postgres, API, dashboard; run migrations.
2. Open dashboard → **Register** (allowed when no users exist).
3. Create organization, project, API key.
4. Set `TELEMETRY_ALLOW_REGISTRATION=false` on API.
5. Schedule retention cron.

---

## v1.0.0 (2026-06-26)

First production-ready self-hosted release. Full changelog: [CHANGELOG.md#100---2026-06-26](../CHANGELOG.md#100---2026-06-26).

**Includes:**

- Multi-tenant ingest (events, errors, sessions, batch) with API keys and plan limits
- Next.js dashboard (overview, errors, events, sessions, org/team/keys settings)
- Email/password auth, org invites, password reset (Resend)
- RBAC (OWNER / EDITOR / VIEWER)
- Optional Stripe billing (checkout, portal, webhooks)
- SDKs `@telemetry-tracker/*` v1.3.0 in-repo (published as `@telemetry-tracker/core`, `@telemetry-tracker/next`, `@telemetry-tracker/node`, `@telemetry-tracker/react-native`)
- Retention job, deployment docs, CI with DB integration tests

**Known limitations:**

- Per-project ingest RPS is in-memory (single API process)
- No built-in error spike alerts
- Open sessions without `ended_at` are not pruned by retention until closed

**Live reference deployment:** `telemetry-tracker.com` (dashboard) / `api.telemetry-tracker.com` (API). Legacy: `telemetry-api.tacko.io`, `telemetry-tracker.tacko.io`.
