# Changelog

All notable changes to the **Telemetry Tracker platform** (API + dashboard) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
App releases use semver tags on `main` (`v1.0.0`, `v1.1.0`, …). SDK packages (`@telemetry-tracker/*`) version independently on npm.

Contributors: add user-facing changes under **[Unreleased]** in your PR to `develop`. Maintainers finalize the version section when promoting a milestone to `main`. See [docs/RELEASE.md](docs/RELEASE.md).

---

## [Unreleased]

---

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
