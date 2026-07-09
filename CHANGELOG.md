# Changelog

All notable changes to the **Telemetry Tracker platform** (API + dashboard) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
App releases use semver tags on `main` (`v1.0.0`, `v1.1.0`, …). SDK packages (`@telemetry-tracker/*`) version independently on npm.

Contributors: add user-facing changes under **[Unreleased]** in your PR to `develop`. Maintainers finalize the version section when promoting a milestone to `main`. See [docs/RELEASE.md](docs/RELEASE.md).

---

## [Unreleased]

### Added

- **Production config verifier** — `scripts/verify-prod-config.sh` runs external checks for the Railway deployment checklist (health, ingest/read auth, CORS, dashboard reachability); documented in [DEPLOYMENT.md](DEPLOYMENT.md) ([#85](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/85))

---

## [1.6.5] - 2026-07-09

### Added

- **Retention dry-run** — `pnpm --filter api retention -- --dry-run` counts rows that would be pruned without deleting; cron logs include `dryRun` in JSON output ([#320](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/320), [#86](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/86))

### Changed

- **Railway ops runbook** — step-by-step retention cron setup, Postgres backup/restore (PITR, snapshots, `pg_dump`), and production-readiness checklist updates ([#320](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/320), [#86](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/86))

---

## [1.6.4] - 2026-07-09

### Changed

- **API `/health` version** — build injects the latest released semver from [CHANGELOG.md](../CHANGELOG.md); `TELEMETRY_API_VERSION` is optional override only (no per-release Railway env) ([#317](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/317))

---

## [1.6.3] - 2026-07-09

### Added

- **Health endpoint metrics** — `GET /health` always includes `version` (build-time from CHANGELOG; optional `TELEMETRY_API_VERSION` override); database probe reports `database_latency_ms` when `HEALTH_CHECK_DATABASE=true`; optional `HEALTH_DETAILED=true` adds `uptime_seconds` and `node_version` for self-host monitoring ([#234](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/234))

---

## [1.6.2] - 2026-07-09

### Added

- **Self-hosted source map uploads** — GitHub Action `base_api_url` input for CI uploads against a custom API host ([#303](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/303))

---

## [1.6.1] - 2026-07-09

### Added

- **Source map upload GitHub Action** — composite action at `.github/actions/upload-source-maps` for CI uploads of `.map` files ([#253](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/253))
- **Source map CI upload auth** — `POST /api/project/source-maps` accepts project API keys (`X-API-Key` or `Authorization: Bearer`) for CI uploads; GitHub Action uses `api_key` input instead of session cookie ([#304](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/304))

---

## [1.6.0] - 2026-07-08

Continues **v1.6.0 — Launch hardening** ([#3](https://github.com/Telemetry-Tracker/telemetry-tracker/milestone/3)).

### Added

- **Automated product update email** — MINOR/MAJOR `vX.Y.Z` tag push triggers [Release product email](.github/workflows/release-email.yml); patch-only tags skipped ([#291](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/291))
- **`MarketingReleaseEmailSend`** — per-subscriber delivery ledger so workflow retries skip already-sent recipients and do not rotate unsubscribe tokens again
- **Release email scripts** — semver bump check, idempotent send with `--previous-version` / `--force` for manual override

### Changed

- **Marketing & release docs** — automation secrets, migrate-before-tag runbook order, and backfill guidance ([MARKETING-EMAIL.md](docs/MARKETING-EMAIL.md), [RELEASE.md](docs/RELEASE.md))

### Database

- Migration `20260708140000_marketing_release_email_send` — `MarketingReleaseEmailSend` table

---

## [1.5.18] - 2026-07-08

### Fixed

- **Overview Signals charts** — restore visible Y-axis labels (remove negative left margin)
- **Overview key metrics** — full-width KPI sparklines on all breakpoints
- **Dashboard top nav** — align scope picker row with page content column

---

## [1.5.17] - 2026-07-08

Continues the **v1.5.0 — Analytics dashboard** milestone ([#195](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/195)).

### Added

- **Performance dashboard page** — KPI row (LCP, INP/FID, CLS, TTFB with prior-period compare and sparklines), vitals-over-time charts with bucket control, Good/Needs improvement/Poor rating bars, env/platform/release filters, and optional avg response + Apdex when `$request` data exists ([#195](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/195))

### Fixed

- **Performance page labels** — page subtitle and rating distribution caption use the API metrics window label (e.g. “Last 7 days”) instead of “Recent data” when no time filter is selected

---

## [1.5.16] - 2026-07-08

Continues the **v1.5.0 — Analytics dashboard** milestone ([#194](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/194)).

### Added

- **`GET /api/performance/summary`** — Web Vitals aggregates (p75/p95 LCP, INP/FID, CLS, TTFB), Good/Needs improvement/Poor rating distribution, per-vital time series, and Node `$request` latency (avg, p95, Apdex) with app/env/release/platform filters ([#194](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/194))

---

## [1.5.15] - 2026-07-08

Continues the **v1.5.0 — Analytics dashboard** milestone ([#193](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/193)).

### Added

- **SDK Web Vitals ingest** — browser/Next SDK captures LCP, INP, CLS, and TTFB as `$web_vital` events ([#193](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/193))

### Fixed

- **SDK Web Vitals opt-out** — re-init with `webVitals: false` stops `$web_vital` events (including async import race)
- **SDK Web Vitals unload flush** — batched vitals flush with keepalive on page hide and tab hidden so CLS/LCP on short visits are not lost

---

## [1.5.14] - 2026-07-08

### Fixed

- **Overview key metrics sparklines** — full-width charts on mobile; keep compact width only in multi-column desktop grids

---

## [1.5.13] - 2026-07-08

### Fixed

- **Sessions KPI sparklines** — use null gaps for empty rate/duration buckets; horizontal mobile layout with fixed-width charts
- **Sessions table on mobile** — truncate user/session IDs, fix duration bar overflow, and restore horizontal scroll for clipped timestamps

---

## [1.5.12] - 2026-07-08

### Fixed

- **Overview page crash** — precompute error detail links on the server instead of passing a function into the top-errors client panel (fixes RSC boundary error on `/dashboard/overview`)

---

## [1.5.11] - 2026-07-08

Continues the **v1.5.0 — Analytics dashboard** milestone ([#183](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/183)).

### Added

- **Overview KPI row** — errors, events, and sessions cards with prior-period compare and sparklines; avg response time and Apdex when Node `$request` duration data exists ([#272](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/272), [#183](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/183))
- **`GET /api/overview`** — `kpiSparklines`, optional `requestMetrics`, `metricsTopErrorGroups`, and `recentSessions` for the overview hero layout
- **Overview layout** — polished telemetry volume chart and top-errors / recent-sessions grid

---

## [1.5.10] - 2026-07-08

Continues the **v1.5.0 — Analytics dashboard** milestone ([#192](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/192)).

### Added

- **Sessions filters and context** — search by user id/email/country/device; Environment, Release, and Country filters; country flag and browser/OS columns; optional user email from `identify()` ([#269](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/269), [#192](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/192))
- **Session ingest** — `country`, `device_browser`, `device_os`, and `user_email` on `POST /ingest/session`; SDK sends device/country context and patches identity on `identify()`
- **`GET /api/sessions`** — list/detail rows include geo/device/email context; summary and analytics honor the expanded filter set

### Database

- Migration `20260708120000_session_geo_device_email` — session geo, device, and email columns

---

## [1.5.9] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#191](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/191)).

### Added

- **Sessions enriched table** — duration with relative bar, pages/events counts, crash-free status badge, default sort by duration, and matching detail fields ([#266](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/266), [#191](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/191))
- **`GET /api/sessions`** — enriched list rows with duration, event/page aggregates, and healthy/warning status aligned with sessions summary rules

---

## [1.5.8] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#190](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/190)).

### Added

- **Sessions analytics panels** — sessions-over-time area chart with Hour/Day/Week bucket control and platform donut, scoped to sessions list filters ([#264](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/264), [#190](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/190))
- **`GET /api/sessions/analytics`** — filtered session volume series and platform groupBy aligned with the sessions list

---

## [1.5.7] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#189](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/189)).

### Added

- **Sessions page summary KPIs** — total sessions, users, avg duration, bounce rate, and crash-free rate with prior-period compare and sparklines ([#262](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/262), [#189](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/189))
- **`GET /api/sessions/summary`** — filtered-window session KPIs aligned with the sessions list

---

## [1.5.6] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#188](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/188)).

### Added

- **Events capture taxonomy** — Auto-captured vs Custom badges on grouped event names (`$`-prefixed SDK events vs custom names) ([#259](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/259), [#188](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/188))

---

## [1.5.5] - 2026-07-07

Docs-only PATCH — contributor workflow ([#256](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/256)).

### Changed

- **Contributing** — GitHub default branch is now **`develop`**; README, PR template, and release docs updated so fork PRs target integration instead of **`main`**

---

## [1.5.4] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#187](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/187)).

### Added

- **Events list trend sparklines** — per-event-name occurrence mini-charts in the grouped table, scoped to the active filters and metrics window ([#252](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/252), [#187](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/187))

---

## [1.5.3] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#186](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/186)).

### Added

- **Events analytics panels** — events-over-time line chart, top events with share % and horizontal bars, and platform breakdown donut scoped to Events page filters ([#249](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/249), [#186](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/186))
- **`GET /api/events/analytics`** — filtered volume series, top event names, and platform groupBy for the events list ([#249](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/249))

---

## [1.5.2] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#185](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/185)).

### Added

- **Events page summary KPIs** — headline metrics row (total events, distinct users, unique event names, distinct sessions) with prior-period comparison ([#245](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/245), [#185](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/185))
- **`GET /api/events/summary`** — filtered-window KPIs for the events list ([#245](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/245))
- **Events grouped table** — paginated, sortable event-name catalog with in-range counts, user totals, and share % ([#245](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/245))

### Changed

- **Events list** — primary view groups occurrences by event name (`view=grouped` default); raw occurrence log available via `view=raw` ([#245](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/245))

---

## [1.5.1] - 2026-07-07

Continues the **v1.5.0 — Analytics dashboard** milestone ([#182](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/182), [#241](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/241)).

### Added

- **Errors analytics panels** — stacked errors-over-time by type and top error types with share % and sparklines ([#242](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/242), [#182](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/182))
- **`GET /api/errors/analytics`** — filtered stacked series and top-type rankings aligned with errors summary filters ([#242](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/242))
- **Errors list type badges and trend sparklines** — per-row error type from message prefix and occurrence trend mini-charts ([#242](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/242))

### Fixed

- **Errors summary KPIs** — scope `events_count` and error rate when status or search filters are active ([#241](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/241))
- **Errors list sort** — sort by Occurrences uses in-range counts via aggregate SQL path ([#241](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/241))
- **Errors analytics totals** — top-type counts use the full KPI window when the stacked chart is bucket-capped ([#242](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/242))

---

First release of the **v1.5.0 — Analytics dashboard** milestone ([#181](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/181)).

### Added

- **Errors page summary KPIs** — headline metrics row (total errors, affected users, error rate, unique groups, resolved groups) with prior-period comparison ([#235](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/235), [#181](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/181))
- **`GET /api/errors/summary`** — filtered-window KPIs for the errors list ([#235](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/235))

### Changed

- **Errors list Count column** — shows in-range occurrence counts instead of lifetime totals ([#235](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/235))
- **Errors list release filter** — filter by release in the toolbar; filter options union event and error-occurrence releases ([#235](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/235))

---

## [1.4.13] - 2026-07-07

### Changed

- **Marketing screenshots** — homepage hero and product errors section use theme-aware light/dark PNGs aligned to the v1.4.12 analytics UI ([#198](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/198))
- **README** — dashboard and errors screenshots use `<picture>` with `prefers-color-scheme` for GitHub rendering ([#198](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/198))

---

## [1.4.12] - 2026-07-07

### Added

- **Analytics UI design system** — shared panel components, metric rows, and list shells for consistent dark analytics chrome across overview, issues, events, sessions, and alerts ([#178](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/178))

### Changed

- **Issue detail** — Sentry-style layout with metrics row, stack trace / occurrences tabs, and sidebar tags and timeline ([#178](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/178))
- **Issues list** — dense table view (error, app, environment, status, count, last seen) instead of card list ([#178](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/178))

### Fixed

- **Issue detail tab** — reset active tab when navigating between issue URLs ([#178](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/178))
- **Issue detail KPI** — `GET /api/errors/:id` now includes `users_affected` and `sessions_affected` (same logic as the issues list) ([#178](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/178))
- **Issue detail metrics** — occurrence count labeled **Occurrences** instead of **Events** ([#178](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/178))

---

## [1.4.11] - 2026-07-06

### Fixed

- **Mobile dashboard UX** — nowrap date columns and responsive table columns; stacked overview greeting; popover width caps for notifications, filters, and profile menu (dropdown closes after item selection); full-width open-issues severity on narrow viewports; compact top errors/events layout; issue title wrapping ([#173](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/173))
- **Overview bar chart flash** — defer Recharts mount until after layout so top errors/events bars no longer flash full-width on first paint ([#173](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/173))
- **Overview metrics window** — when time range is unselected, headline metrics, charts, and compare use a data-adaptive 7–90 day window (30-day fallback when empty) instead of ~840 days; event/error lists stay all-time ([#174](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/174))

### Changed

- Overview API returns `metricsSince`, `metricsUntil`, and `metricsDurationMs` for the resolved metrics window; dashboard docs updated ([#174](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/174))

---

## [1.4.9] - 2026-07-06

### Fixed

- **Cookies policy (mobile)** — mobile card layout and word wrapping for the IN SHORT callout; prevent horizontal overflow from the cookies table

## [1.4.8] - 2026-07-06

### Fixed

- **Marketing site (mobile)** — responsive layout for nav, hero, pricing, SDKs, and footer; prevent horizontal overflow on small viewports
- **Docs (mobile)** — drawer navigation with body scroll lock; improved code blocks and article layout on narrow screens

---

## [1.4.7] - 2026-07-06

### Fixed

- **Dashboard (mobile)** — contain nav scope-picker overflow so the header stays within the viewport and the user menu remains visible
- **Dashboard (mobile)** — restore portaled `TimeRangePicker` popover so the Filter by date panel is not clipped on Overview and list pages

---

## [1.4.6] - 2026-07-06

### Fixed

- **Dashboard (mobile)** — compact top nav with scrollable scope pickers and tab bar; Overview greeting shows a short first name instead of a full email
- **Dashboard** — clamp long error titles in issue lists and open-incident cards (full message remains on error detail); collapse Filters & sort on small viewports; improve overflow handling on tables and page titles

---



## [1.4.5] - 2026-07-04

### Fixed

- **API** — CORS on `/ingest/*` reflects the request `Origin` (no credentials) so browser SDKs on customer domains can send authenticated ingest traffic; dashboard `/api/*` routes keep the configured allowlist with credentials

---

## [1.4.4] - 2026-07-04

### Changed

- **Docs** — README roadmap uses a compact, collapsible format with **Planned** vs **Exploring** tiers; Features table unchanged

### Added

- **Ops** — [RELEASE.md](docs/RELEASE.md): PATCH and docs hotfixes **should** be assigned to a GitHub milestone for audit trail (typically the active patch-line milestone)

---

## [1.4.3] - 2026-07-04

### Added

- **Ops** — Maintainer workflow for manual product update emails ([MARKETING-EMAIL.md](docs/MARKETING-EMAIL.md), [RELEASE.md](docs/RELEASE.md) step 8); `send-release-email.ts` adds `--help`, requires `--version` for live sends, and prints a CHANGELOG preview on dry-run

---



## [1.4.2] - 2026-07-03

### Added

- **Marketing email list** — `MarketingSubscriber` model with subscribe/unsubscribe API, footer and contact subscribe forms, registration opt-in (default on), privacy policy updates, and `scripts/send-release-email.ts` for manual release broadcasts via Resend
- **Social share banner** — official marketing banner at `/og-banner.png` (1024×409) for Open Graph, Twitter cards, and GitHub social preview
- **Ops** — Resend production setup runbook; production `/health` includes email provider status; `scripts/smoke-production.sh` asserts email configuration

### Changed

- **Marketing home** — Supported SDKs use brand SVG icons instead of emoji placeholders
- **Marketing footer** — Resources column links to doc hubs (SDK guides, dashboard guide) instead of individual SDK pages
- **Open Graph image** — replace dynamic `/opengraph-image` generator with static `/og-banner.png` marketing banner

### Fixed

- **API** — initialize Sentry on startup (`initSentryIfConfigured` in API entrypoint)
- **Dashboard** — allow optional `className` on Supported SDKs list items

### Database

After upgrading from v1.4.1, run:

```bash
pnpm --filter api exec prisma migrate deploy
```

New migrations in this release:

- `20260703140000_marketing_subscriber` — marketing email subscriber list with consent and unsubscribe tokens

---

## [1.4.1] - 2026-07-03

### Added

- **Release notes** — `/docs/releases` renders platform semver history from `CHANGELOG.md`
- **Marketing docs preview** — Platform release notes card on landing page
- **Google Analytics** — GA4 (`G-VL5GTNNCHH`) on hosted cloud after cookie consent

### Changed

- **Marketing home** — replace placeholder logo strip with Supported SDKs (React, Next.js, Vue, Nuxt, React Native, Node.js, NestJS)

### Fixed

- **Release notes parser** — render `Database` and `SDK compatibility` sections (migration commands, migration lists, SDK version notes) on `/docs/releases`
- **Dashboard Docker image** — copy `CHANGELOG.md` into the runner stage so `/docs/releases` can load it at runtime
- **Google Analytics** — resolve measurement id on the server; restore localStorage consent notifies GA; limit tracking to non-dashboard routes; guard null pathname; send SPA pageviews on client navigations; preserve gtag readiness after dashboard detours

---

## [1.4.0] - 2026-07-03

### Added

- **Docs** — Vue, NestJS, and Nuxt SDK guides on `/docs` plus matching repo markdown (`docs/sdk-vue.md`, `docs/sdk-nestjs.md`, `docs/sdk-nuxt.md`)
- **Ops** — `scripts/smoke-production.sh` for repeatable production smoke checks (#87)

### Changed

- **Hosted cloud docs** — production ingest URL documented as `api.telemetry-tracker.com`
- **Marketing docs** — SDK section tabs include Vue, Nuxt, and NestJS; version badge updated to v1.3.0; sitemap includes `/docs/hosted-cloud`

---

## [1.3.4] - 2026-07-03

### Fixed

- **Billing CTAs** — hide “Upgrade to Pro” when already on Pro; highlight the next applicable upgrade or Manage billing

---

## [1.3.3] - 2026-07-03

### Changed

- **Logo** — nav and brand components use the new `telemetry-logo.jpg` mark

---

## [1.3.2] - 2026-07-03

### Changed

- **Brand icons** — updated favicon, apple-touch-icon, Android chrome icons, and PWA manifest assets

---

## [1.3.1] - 2026-07-02

### Added

- **Hosted cloud docs** — `/docs/hosted-cloud` getting-started guide for telemetry-tracker.com
- **Open Graph image** — dynamic 1200×630 social preview at `/opengraph-image`

### Changed

- **SDK npm scope** — packages renamed from `@tacko/telemetry-*` to `@telemetry-tracker/core`, `@telemetry-tracker/next`, `@telemetry-tracker/node`, and `@telemetry-tracker/react-native` (v1.3.0 in-repo). Publish under `@telemetry-tracker/*` on npm; deprecate legacy `@tacko/*` names after publish.
- **Marketing & legal** — homepage features/hero mention alerting and source maps; Terms and Privacy tailored for official hosted cloud; alert quick action links to `/dashboard/alerts`

---

## [1.3.0] - 2026-07-02

### Added

- **Source maps v1** — persist `release` on errors; upload JSON source maps via `POST /api/project/source-maps`; server-side stack symbolication on error detail (`symbolicated_stack`); dashboard raw/symbolicated toggle; Settings → Source maps listing; per-plan artifact storage quotas (FREE 25 / PRO 250 / BUSINESS 2 500)

### Changed

- **`maintainer-review` on `develop`** — same gate as `main`: 0 human approvals; check auto-passes for @unjica PRs, requires maintainer approval for others

### Database

After upgrading from v1.2.x, run:

```bash
pnpm --filter api exec prisma migrate deploy
```

New migrations in this release:

- `20260703120000_error_release` — `release` column on `ErrorGroup` and `ErrorOccurrence`
- `20260703130000_source_map_artifacts` — source map storage keyed by project, app, release, and bundle URL

---

## [1.2.1] - 2026-06-28

### Changed

- **Official hosted cloud URL** — documentation and env examples now use [telemetry-tracker.com](https://telemetry-tracker.com) as the canonical dashboard domain (legacy `telemetry-tracker.tacko.io` redirects)

---

## [1.2.0] - 2026-07-01

### Added

- **Alerting v1** — per-project error spike and quota threshold rules, alert history, in-app bell + email delivery, and `/dashboard/alerts` settings UI
- **Bugbot review rules** — `.cursor/BUGBOT.md` (repo, API, dashboard, SDK) plus contributor docs for local `/review-bugbot` and GitHub integration

### Database

After upgrading from v1.1.0, run:

```bash
pnpm --filter api exec prisma migrate deploy
```

New migrations in this release:

- `20260702120000_project_alerts`
- `20260702130000_alert_event_href`

### SDK compatibility

- Platform v1.2.x works with `@telemetry-tracker/*` **>= 1.2.0** (no npm publish required for this release)

---

## [1.1.0] - 2026-07-01

### Added

- **Notifications v1** — in-app bell with read state, notification preferences, transactional email for billing/quota/team/error alerts, and email dedupe
- **Light theme** — dark (default), light, and system appearance; Appearance settings page
- **Flexible time ranges** — Sentry-style date picker and custom ranges across overview and list views
- **Dashboard load performance** — bootstrap API, streaming layout shell, and faster workspace resolution
- **Nav scope pickers** — rich project and app switchers with pinned/recent/search and health dots
- Overview performance indexes and chart/query scope fixes for time ranges

### Changed

- Overview metrics, charts, and list filters align on selected time range and `until` bounds
- Team invite and billing notification ids scoped for correct read state and email dedupe across orgs and re-invites

### Fixed

- Mark-all-read respects quiet-hours-hidden items and sidebar org/project scope
- Invite emails send on re-invite with rotated tokens; error-group emails send only after occurrence persistence
- Theme hydration on Appearance page; chart SSR colors match default dark theme

### Database

After upgrading from v1.0.0, run:

```bash
pnpm --filter api exec prisma migrate deploy
```

New migrations in this release:

- `20260628120000_overview_perf_indexes`
- `20260701120000_user_notification_preferences`
- `20260701130000_notification_read_and_email_log`
- `20260701140000_organization_invite_email_sent_at`
- `20260701150000_organization_invite_email_sent_token`

### SDK compatibility

- Platform v1.1.x works with `@telemetry-tracker/*` **>= 1.2.0** (no npm publish required for this release unless SDK APIs changed)

---

## [1.0.0] - 2026-06-26

First production-ready self-hosted release. See [docs/RELEASE.md#v100-2026-06-26](docs/RELEASE.md#v100-2026-06-26) for full notes.
