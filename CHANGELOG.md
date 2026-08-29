# Changelog

All notable changes to the **Telemetry Tracker platform** (API + dashboard) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
App releases use semver tags on `main` (`v1.0.0`, `v1.1.0`, …). SDK packages (`@telemetry-tracker/*`) version independently on npm.

Contributors: add user-facing changes under **[Unreleased]** in your PR to `develop`. Maintainers finalize the version section when promoting a milestone to `main`. See [docs/RELEASE.md](docs/RELEASE.md).

---

## [Unreleased]

### Added

### Fixed

- **Retention job** — process projects in keyset batches and continue after a per-project failure; the cron still exits non-zero if any project failed

### Changed

- **Dashboard Docker image** — runtime `pnpm install` no longer forces devDependencies (`--prod=false`); `NODE_ENV=production` installs production deps only

### Database

---

## [1.17.5] - 2026-08-28

### Changed

- **Dashboard a11y** — theme picker uses `radiogroup` / `radio` ARIA semantics so screen readers announce the active theme ([#372](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/372), [#612](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/612))

---

## [1.17.4] - 2026-08-28

### Changed

- **Hosted Pro pricing** — list price €15/month (was €29); new checkouts use the Price id in `STRIPE_PRICE_PRO`. Existing Pro subscriptions keep their prior Stripe Price and stay PRO via `plan_tier` metadata ([#613](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/613))
- **Dashboard a11y** — `aria-label` on settings sidebar navigation ([#610](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/610))

---

## [1.17.3] - 2026-07-19

### Changed

- **Docs** — mark Performance / Web Vitals, Releases, and Global search as shipped in README (EN/DE/ES) and site `/docs/dashboard`; mark roadmap milestones v1.16.x and v1.17.x as shipped

---

## [1.17.2] - 2026-07-19

### Added

- **Performance Overview card** — Overview Web Vitals snapshot (LCP, INP/FID, CLS, TTFB) with Good / Needs improvement / Poor classification, rating distribution bars, scoped `View report →` to Performance, and empty-state handling when no vitals exist ([#197](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/197); milestone v1.17.x — Performance Intelligence)

---

## [1.17.1] - 2026-07-19

### Fixed

- **Concurrent error-group create race** — `findOrCreateErrorGroup` now handles Prisma P2002 on unique `(project_id, fingerprint)` by re-fetching the existing group and incrementing occurrences (`isNew: false`), so concurrent `POST /ingest/error` no longer 500s ([#599](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/599))

---

## [1.17.0] - 2026-07-19

### Added

- **Slow routes & slow pages** — Performance page tables for slowest `$request` routes (method, path, count, p50/p95, error rate) and `$web_vital` pages (path, LCP p75, CLS, samples), with pagination, small-sample callouts, and scope-preserving deep links to Events ([#196](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/196); milestone v1.17.x — Performance Intelligence)
- **Compare periods** — explicit period-comparison mode across Overview, Errors, Events, and Sessions with calendar presets (Today vs Yesterday, week, month; UTC), equal-duration custom ranges (`compare` / `compareFrom` / `compareTo`), unified New/— delta formatting, and release-vs-previous “New” handling on Releases ([#495](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/495); milestone v1.17.x — Performance Intelligence)
- **Product update email on milestone close** — closing a `vX.Y.x — …` GitHub milestone auto-sends the line-close product email (latest tag on that minor + previous minor final); tag pushes still skip; workflow `dry_run` input for previews ([docs/MARKETING-EMAIL.md](docs/MARKETING-EMAIL.md))

### Changed

- **Bugbot gate paused** — `bugbot-review` required check is a reversible no-op (`BUGBOT_REVIEW_ENABLED=false` in [`.github/workflows/bugbot-review.yml`](.github/workflows/bugbot-review.yml)); flip to `true` to restore the Cursor Bugbot wait for maintainer PRs ([CONTRIBUTING.md](CONTRIBUTING.md#ai-code-review-bugbot))

---

## [1.16.7] - 2026-07-19

### Fixed

- **Dependabot #45 / Sentry 10** — upgrade `@sentry/node` and `@sentry/nextjs` to v10 so transitive `@opentelemetry/core` lands on ≥2.8.0 (unbounded W3C baggage parse); move dashboard client init to `instrumentation-client.ts` and update `withSentryConfig` for Sentry 10 ([#590](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/590))
- **GitHub Code Quality findings** — clear open dashboard quality alerts (dead null checks, trivial conditionals, unused locals) ([#591](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/591))

---

## [1.16.6] - 2026-07-19

### Fixed

- **CodeQL medium / Actions hygiene** — harden GitHub Actions (`permissions`, pin `pnpm/action-setup`, env-based composite inputs), sanitize CR/LF in email/dashboard debug logs, and harden publish CLI (`execFile` + validated OTP args) ([#586](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/586))
- **Dependabot moderate/low alerts** — resolve transitive advisories via pnpm overrides for `js-yaml`, `yaml`, `postcss`, `uuid`, `brace-expansion`, `@babel/core`, `esbuild`, and `diff` ([#587](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/587)). **Still open:** Dependabot [#45](https://github.com/Telemetry-Tracker/telemetry-tracker/security/dependabot/45) (`@opentelemetry/core`) blocked on Sentry 9→10 (OTel 2.x)

---

## [1.16.5] - 2026-07-19

### Fixed

- **Quota alert plan context** — avoid Prisma required-relation null errors in `loadPlanContextForProject` when ingest fire-and-forget quota hooks race org cascade deletes (integration teardown), and swallow alert load failures so they cannot fail the request ([#583](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/583))

---

## [1.16.4] - 2026-07-19

### Fixed

- **Dependabot high alerts** — resolve high-severity transitive dependency alerts via lockfile upgrades and pnpm overrides: `next` (≥15.5.18), `ws` (7.5.11 / 8.21.1), `defu` (≥6.1.5), `lodash` (4.18.1), and `effect` (≥3.20.0) ([#581](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/581))

---

## [1.16.3] - 2026-07-19

### Fixed

- **CodeQL high alerts** — prefer Web Crypto for client UUID generation (non-`Math.random` fallback), replace polynomial email/slug regexes with linear checks, and correct smoke-test email assertion anchors ([#578](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/578))
- **Project slug trim order** — trim leading/trailing separators before the length clamp so a leading dash does not steal a character from the 64-char budget ([#578](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/578))

---

## [1.16.2] - 2026-07-19

### Fixed

- **Dashboard API SSRF hardening** — restrict `dashboardApiFetch` to relative `/api` paths on `API_BASE_URL` and validate error group ids before path interpolation ([#574](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/574); CodeQL #12)
- **Dashboard API URL join** — preserve an `API_URL` path prefix when resolving `/api/...` paths, and treat non-UUID error/event/session route ids as not-found instead of throwing in the URL resolver ([#576](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/576))
- **shell-quote CVE-2026-9277** — pin transitive `shell-quote` to `>=1.8.4` via pnpm override for Dependabot alert #38 ([#575](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/575))

---

## [1.16.1] - 2026-07-19

### Added

- **Global Search** — project-scoped search across issues, events, sessions, releases, and users (`/dashboard/search`, `GET /api/search`) with free text and `key:value` filters; grouped results (8 per group), keyboard navigation, ignored-key feedback, and View all deep links ([#494](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/494); [#571](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/571); milestone v1.16.x — Release Intelligence)

### Fixed

- **Global Search list parity** — align hits and View all with Issues/Events/Sessions filters: effective-release + NULL-env fallback, `metricsUntil` / nav time windows, release activity window, recent-user ranking, URL tokens as free text, AND multi-word `q`, and pending-nav submit guard ([#494](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/494))
- **Dashboard Sentry client capture** — re-check `window` inside async product-telemetry callbacks so Vitest teardown cannot throw `window is not defined` after `captureClientException`

---

## [1.16.0] - 2026-07-18

### Added

- **Releases Health** — enable `/dashboard/releases` (nav + Quick Action) with per-release sessions, active users, events, errors, adoption share, and error rate; environment/platform/date-range filters; sort by recency/adoption/errors/error rate; vs-previous-release deltas (Unknown excluded from the comparison chain); deep links to Issues/Events/Sessions ([#453](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/453); [#568](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/568); milestone v1.16.x — Release Intelligence)
- **`GET /api/releases/summary`** — aggregates release health KPIs including an explicit **Unknown** bucket in the adoption denominator
- **`release=__unknown__` filter** — URL allow-list, list/overview filters with TRIM matching, and Unknown option in release pickers so deep links never rely on an empty `release=` param

### Fixed

- **Release filter attribution** — align Unknown and known-release filters across Prisma/SQL lists, Overview KPIs/active users, issue-detail occurrences, and event-release fallback (platform-scoped; all-time for known releases; exclude event-fallback sessions from Unknown)
- **metricsUntil deep links** — honor and preserve `metricsUntil` across Overview, Release Health links, list toolbars, and nav tab switches so open-ended KPI windows stay consistent

---

## [1.15.9] - 2026-07-18

### Fixed

- **Email brand logo in Gmail** — embed the mark as a CID inline attachment instead of a hotlinked URL so Gmail Image Proxy / Cloudflare no longer shows a broken placeholder ([#559](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/559))

---

## [1.15.8] - 2026-07-18

### Added

- **GitHub CodeQL Advanced** — CI workflow scans `actions` and `javascript-typescript` on pushes/PRs to `develop`/`main`, plus a weekly schedule ([#561](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/561))

---

## [1.15.7] - 2026-07-18

### Changed

- **Docs staleness pass** — align RELEASE / PRODUCTION-READINESS / ROADMAP / MONITORING with shipped Notifications + Alert Rules, Railway `alert-rules-evaluator` cron (leave `brief-worker` alone), and corrected ops notes (CI does not migrate production; Slack/Discord Delivery shipped) ([#556](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/556))

---

## [1.15.6] - 2026-07-18

### Fixed

- **Settings Field label association** — `Field` and `SettingsToggle` wire `htmlFor` / `id` so settings labels activate their controls (alerts, notifications, preferences, labs) ([#460](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/460))

### Changed

- **Product update email on line close** — send when finishing the last intended release of a minor (`vX.Y.*`), summarizing the whole line since the previous product email; do not auto-send on the first `.0` of the next milestone. Workflow `line_close` + `--line-close` compose full-minor CHANGELOG; mid-line patches stay skip ([#553](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/553); [docs/MARKETING-EMAIL.md](docs/MARKETING-EMAIL.md), [docs/RELEASE.md](docs/RELEASE.md))

---

## [1.15.5] - 2026-07-18

### Changed

- **Dependency security bumps** — Dependabot group update: `fastify` 5.8.5, `next` 15.5.18, `postcss` 8.5.10, `vitest` 3.2.6, plus transitive `fast-uri` / `picomatch` ([#551](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/551))

---

## [1.15.4] - 2026-07-18

### Changed

- **Vite dependency alignment** — pin `vite@7.3.5` via root `pnpm.overrides` (Dependabot bump from 7.3.2) so the monorepo resolves a single patched Vite ([#545](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/545))

---

## [1.15.3] - 2026-07-18

### Fixed

- **Production smoke billing portal probe** — `scripts/smoke-production.sh` sends `-d '{}'` with `Content-Type: application/json` on `POST …/billing/portal` so Fastify no longer rejects an empty body (Sentry `FastifyError` during v1.15.2 smoke) ([#547](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/547))

---

## [1.15.2] - 2026-07-18

### Added

- **Alert rules built-in integration** — error-spike and quota alerts are system-managed `AlertRule` rows (`source=SYSTEM`, stable `migration_key`); idempotent ensure/backfill from `alert_settings`; dual-write via alert-settings API; custom CRUD/evaluators skip SYSTEM so delivery stays on `fireProjectAlert` with legacy dedupe keys ([#535](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/535); parent [#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493))
- **Alert rules dashboard UX** — edit existing rules, multi-condition (AND) authoring matching the API, clearer opaque destination picker, and validation/empty-state polish on Alerts → Custom rules ([#533](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/533); parent [#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493))
- **Alert rules conditions + scheduled evaluator** — API support for `ERROR_RATE`, `SESSION_DROP`, `NEW_ERROR_GROUP`, `AFFECTED_USERS`, `QUOTA_PERCENT`, `NO_EVENTS`, and `HEARTBEAT`; skip-safe unknown condition types; ingest + scheduled evaluation paths with shared `last_fired_at` cooldown into `fireProjectAlert`; cron entrypoint `alert-rules-evaluator` ([#534](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/534); parent [#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493))

### Fixed

- **Event ingest environment normalization** — `/event` and `/batch` now trim/cap `environment` like sessions and errors so AlertRule `NO_EVENTS` / `HEARTBEAT` environment filters match stored rows ([#534](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/534))
- **Alert rule cooldown** — fires are gated by elapsed time since `last_fired_at` (atomic claim), not wall-clock dedupe buckets, so scheduled conditions cannot re-fire when a cooldown bucket rolls ([#534](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/534))
- **Scheduled alert-rules org gate** — evaluator skips soft-deleted projects and soft-deleted organizations, matching ingest API-key auth ([#534](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/534))

### Changed

- **Alert rules docs / ops** — [docs/ALERT-RULES.md](docs/ALERT-RULES.md) and [docs/RAILWAY.md](docs/RAILWAY.md) document scheduled evaluation cadence (`ALERT_RULES_SCHEDULE_INTERVAL_MINUTES`, default 5); built-in spike/quota migration and dual-write noted in ALERT-RULES

### Database

- `AlertRule.source` / `system_kind` / `migration_key` for system-managed built-in rules (`20260718140000_alert_rule_system_builtin`)
- `AlertRule.last_fired_at` for concurrency-safe cooldown claims (`20260718120000_alert_rule_last_fired_at`)

## [1.15.1] - 2026-07-17

### Fixed

- **Marketing reserved email domains** — reject RFC/example reserved domains (e.g. `example.com`, `*.test`) on marketing subscribe, and skip those addresses when sending product update emails so Resend 422s no longer abort release broadcasts ([#539](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/539))

---

## [1.15.0] - 2026-07-17

### Added

- **Alert rules (foundation)** — configurable per-project rules with `Condition[]` (AND), opaque `destinationIds` resolved by Notifications (`project-email` + `ProjectWebhook` ids), Alerts → Custom rules CRUD, and ingest-time evaluation for `ERROR_COUNT` with cooldown dedupe into existing `fireProjectAlert` fan-out ([#532](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/532); parent vision [#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493); milestone v1.15.x). Rules decide conditions → trigger → bindings; Notifications owns delivery.
- **Alert Rules docs** — [docs/ALERT-RULES.md](docs/ALERT-RULES.md) separation of concerns, condition model, and destination binding notes; ALERT-WEBHOOKS cross-links updated

### Database

- `AlertRule` table (`conditions` JSON AND-array, `destination_ids` opaque refs); `AlertRuleType.ALERT_RULE` for custom-rule firings (`20260717220000_alert_rules`)
- `ErrorOccurrence.environment` for accurate alert-rule environment scope (group-level env remains a last-seen tag only) (`20260717223000_error_occurrence_environment`)

---

## [1.14.4] - 2026-07-17

### Fixed

- **Alert webhook delivery on Node 24** — pinned HTTPS `lookup` now returns an address array when Node requests `{ all: true }`, fixing `Invalid IP address: undefined` delivery failures

### Changed

- **Release process** — document merge-only-when-required-checks-are-green and milestone close-out notes ([#526](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/526))

---

## [1.14.3] - 2026-07-17

### Added

- **Slack alert notifications** — add Slack Incoming Webhook destinations on Alerts → Delivery; worker POSTs Slack Block Kit–compatible JSON (title, body, rule, dashboard link) when alerts fire; Integrations catalog marks Slack connected when an enabled Slack destination exists ([#223](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/223); parent vision [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492); builds on [#225](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/225))
- **Discord alert notifications** — add Discord webhook destinations on Alerts → Delivery; worker POSTs embed JSON (title, body, rule, dashboard link) when alerts fire; Integrations catalog marks Discord connected when an enabled Discord destination exists ([#224](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/224); parent vision [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492))
- **Telegram and Microsoft Teams alert channels** — add Teams Incoming Webhook and Telegram Bot API (`sendMessage` + chat id) destinations on Alerts → Delivery; Integrations catalog marks each connected when an enabled destination exists ([#500](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/500); parent vision [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492))

### Database

- `ProjectWebhook.provider` (`GENERIC` | `SLACK` | `DISCORD` | `MICROSOFT_TEAMS` | `TELEGRAM`) and optional `config` JSON for provider-specific non-secret settings (e.g. Telegram chat id)

---

## [1.14.2] - 2026-07-17

### Added

- **Email alert delivery** — branded templates for error spike, new error, quota near/exceeded, and generic/custom alerts; per-project email recipients (roles + additional addresses) on Alerts → Email recipients; quiet hours apply to email as well as in-app; temporary mute and digest preference hooks in Settings → Notifications ([#499](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/499); parent vision [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492))

---

## [1.14.1] - 2026-07-17

### Added

- **Notification Center** — `/dashboard/notifications` inbox with day grouping, read/unread, project and type filters, and links into the dashboard; bell feed gains a “View all” entry while remaining the compact active-project preview ([#508](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/508); parent vision [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492))

---

## [1.14.0] - 2026-07-17

### Added

- **Alert webhooks** — configure HTTPS destinations per project on Alerts → Delivery; `fireProjectAlert` enqueues durable `PENDING` deliveries (worker POSTs signed `alert.fired` JSON with DNS-pinned SSRF checks + retry); operators can browse delivery status in the same Delivery section ([#225](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/225); parent vision [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492))

### Database

- `ProjectWebhook` and `AlertWebhookDelivery` tables for outbound alert webhook destinations; delivery rows use claim/lease fields (`PENDING`/`PROCESSING`, `lease_owner`, `lease_expires_at`, `next_attempt_at`) plus attempt/dead-letter history

---

## [1.13.2] - 2026-07-17

### Fixed

- **Navigation overlay** — profile/settings links from the user menu, quick actions, and theme entry use the shared nav loader; soft navigations keep the overlay visible for a short minimum so fast settings pages still show it ([#503](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/503))

---

## [1.13.1] - 2026-07-17

### Fixed

- **Navigation overlay** — after a workspace/project switch, keep the full-screen loader until the refresh settle hold finishes (not only when the nav scope ack arrives), so list/overview RSC is less likely to flash stale data

---

## [1.13.0] - 2026-07-17

### Added

- Dashboard: full-screen loading overlay while switching app, environment, workspace, project, section tabs, settings pages, time range, and command-palette / keyboard navigation ([#484](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/484)).
- **Rename project** — owners can update project name and slug from Settings → Organization; project switcher “Rename this project” links to the edit form ([#480](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/480))
- **Rename workspace** — owners can update the organization name from Settings → Organization; org switcher “Rename your workspace” links to the edit form ([#482](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/482))

### Fixed

- **Overview session counts** — fix Postgres syntax error (42601 near `s`) on `GET /api/overview` when environment or release filters are set (missing `AND` before upper-bound `started_at` / `created_at` clauses) ([#490](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/490))

### Changed

- Dashboard: errors, events, and sessions list pages load filters, summary, and the table first; analytics panels render below the list and fetch after paint so above-the-fold content is not blocked ([#486](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/486)).

---

## [1.12.1] - 2026-07-17

### Fixed

- **Logout** — Log out no longer closes the user menu before the server action runs (which aborted logout and left the session cookie intact)

---

## [1.12.0] - 2026-07-16

### Added

- **Ingest PII scrubbing** — default server-side redaction of emails, tokens, API keys, and sensitive keys in error messages/stacks/context and event properties before persistence; disable with `TELEMETRY_INGEST_PII_SCRUB=false` ([#470](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/470))
- **PII scrubbing (Phase 2)** — optional SDK `piiScrub` in `@telemetry-tracker/core` 1.4.0; project deny-list keys (`pii_scrub_settings`) on Alerts; ingest merges deny-keys with server defaults ([#470](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/470))
- **PII scrubbing (Phase 3a)** — phone / payment-card text heuristics; opt-in `scrubSessionUserEmail`; organization audit events on PII settings changes ([#470](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/470))
- **PII scrubbing (Phase 3b)** — opt-in CLI backfill for stored events/errors/sessions (`pnpm --filter api pii-scrub-backfill`) ([#470](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/470))

### Database

- Migration `20260716200000_project_pii_scrub_settings` — `Project.pii_scrub_settings` JSON

### Fixed

- **Alerts PII settings** — failed or invalid settings responses no longer crash the page or allow saving empty deny-keys that would wipe stored project keys

---

## [1.11.3] - 2026-07-16

### Fixed

- **Errors summary** — avoid `Prisma.join([])` crash on `GET /api/errors/summary` when no release/platform filter is set ([#468](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/468))

---

## [1.11.2] - 2026-07-16

### Fixed

- **Dashboard Docker build** — commit missing `@telemetry-tracker/core` `device-context` dist artifacts; rebuild workspace packages in the Dockerfile before `next build` so Railway does not fail with `Can't resolve './device-context.js'`

---

## [1.11.1] - 2026-07-16

### Added

- **Product telemetry (dogfood)** — optional `@telemetry-tracker/next` on `/dashboard` for visits, sessions, and browser errors when `NEXT_PUBLIC_TELEMETRY_INGEST_URL` + `NEXT_PUBLIC_TELEMETRY_API_KEY` are set (marketing/docs unchanged) ([#463](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/463))
- **SDK** — `shutdown()` in `@telemetry-tracker/core` / `@telemetry-tracker/next`; `TelemetryProvider` tears down on unmount so leaving `/dashboard` stops ingest ([#463](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/463))
- **SDK** — `TelemetryProvider` inits in `useLayoutEffect` so the first `useTrackPage` screen attaches to the new session ([#464](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/464))

---

## [1.11.0] - 2026-07-16

### Added

- **Errors platform** — persist `platform` on error groups/occurrences; Platform filter on Errors; include in filter-options ([#445](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/445))
- **Session environment & release** — store on `Session` at ingest; SDK sends `release` on session payloads; filters prefer session columns with event fallback ([#446](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/446), [#447](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/447))
- **Overview scope** — Platform and Release filters on Overview ([#445](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/445), [#448](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/448))
- **List columns** — Sessions Platform; Events Release + First seen; Errors Release, Users/Sessions affected ([#449](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/449), [#450](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/450), [#451](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/451), [#456](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/456))
- **Error detail** — Sessions affected, fingerprint, trend sparkline; clickable session links ([#451](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/451), [#454](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/454))

### Changed

- **Errors first/last seen** — when filtering by release or platform, timestamps reflect matching occurrences (not only fingerprint lifetime) ([#455](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/455))
- **React Native docs** — prefer `Platform.OS` → `ios`/`android`/`web`; document `release` (app version) and `environment` ([#452](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/452), [#457](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/457))

### Database

- Migration `20260715220000_error_platform_session_env_release` — `ErrorGroup.platform`, `ErrorOccurrence.platform`, `Session.environment`, `Session.release`

---

## [1.10.0] - 2026-07-15

### Added

- **Workspace brief (API)** — Phase Async-A: Postgres-backed `BriefCompleted` and `BriefGenerationJob` storage, organization-scoped background worker, async read path (current → stale → enqueue + factual fallback), and `meta.source: "stale"` ([#440](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/440))

### Changed

- **Workspace brief (API)** — synchronous AI read path and L1 cache removed from `POST /api/meta/brief/workspace`; generation is worker-driven with immutable `requestId` per job

---

## [1.9.2] - 2026-07-15

### Added

- **Dashboard** — copy-to-clipboard button on JSON context blocks (event properties and error context) ([#232](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/232), [#439](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/439))

---

## [1.9.1] - 2026-07-14

### Changed

- **Release product email** — dashboard-aligned HTML template with branded header, version pill, and CTAs; resolves relative CHANGELOG links for email clients; blocks unsafe link schemes ([#437](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/437))

---

## [1.9.0] - 2026-07-14

### Added

- **Analytics lists** — client-side table sort and pagination for sessions, errors, and events without full page reload ([#418](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/418), [#432](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/432))
- **Pagination** — Previous and Next controls on shared list pagination ([#365](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/365), [#433](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/433))
- **Time range UX** — default **24h** on first visit; explicit **No date filter** uses `range=none` ([#420](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/420), [#427](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/427))
- **Loading feedback** — transitions and route skeletons when changing time range, filters, or app scope ([#421](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/421), [#419](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/419), [#427](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/427), [#428](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/428))
- **Overview** — all-apps banner, metric definition help, remove duplicate Ingest mix card ([#423](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/423), [#427](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/427))
- **Sessions analytics** — average session duration per user ([#424](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/424), [#429](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/429)); new vs returning user cohorts ([#425](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/425), [#431](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/431)); user first-seen on session detail ([#426](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/426), [#430](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/430))
- **Workspace brief (API)** — Phase 3C orchestration with snapshot signing, semantic cache, circuit breaker, and `POST /api/meta/brief/workspace` + ack ([#416](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/416))

### Changed

- **Time range picker** — clearer copy when the table is unfiltered but charts use a recent window ([#422](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/422), [#427](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/427))

---

## [1.8.11] - 2026-07-14

### Added

- **Team settings** — copy invite link button on Settings → Team members ([#367](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/367), [#413](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/413))

### Changed

- **Documentation** — Spanish README translation ([#214](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/214), [#412](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/412))

---

## [1.8.10] - 2026-07-13

### Added

- **Labs settings** — user-scoped `labs_preferences` with `GET`/`PATCH /api/meta/labs-preferences`; Settings → Labs toggles (including command palette ⌘K gating in top nav) persisted per user ([#360](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/360), [#409](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/409))

---

## [1.8.9] - 2026-07-13

### Added

- **Integrations hub** — `GET /meta/organizations/:orgId/integrations` with session auth and org membership checks; dashboard Settings → Integrations loads connected state from the API (GitHub, Stripe, and catalog stubs for Slack, Discord, webhooks) ([#359](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/359), [#406](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/406))

---

## [1.8.8] - 2026-07-13

### Added

- **Organization audit log** — org-scoped trail for dashboard security and profile actions (login, password change, session revoke, profile and avatar updates); `GET /meta/organizations/:orgId/audit-log` with cursor pagination; Settings → Audit log UI ([#358](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/358), [#403](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/403))

---

## [1.8.7] - 2026-07-12

### Fixed

- **Avatar access** — exclude deleted orgs from avatar access

---

## [1.8.6] - 2026-07-12

### Added

- **Profile avatars** — upload PNG/JPEG/WebP (≤512 KB) to Cloudflare R2; `avatar_key` on `User`; authenticated API and dashboard `/avatar/[userId]` proxy; profile settings, user menu, and team members ([#361](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/361), [#396](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/396))

### Fixed

- **Avatar upload** — accept standard image `Content-Type` values so browser uploads are not rejected with 415 ([#396](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/396))

---



## [1.8.5] - 2026-07-12

### Added

- **Security settings** — list and revoke dashboard sessions (device/browser hints on sign-in), change password via API; settings page loads real session data ([#357](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/357), [#390](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/390))

### Fixed

- **Issue detail tabs** — ARIA `tablist` / `tab` / `tabpanel` roles and wiring for Stack trace and Occurrences ([#379](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/379), [#393](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/393), thanks [@MFA-G](https://github.com/MFA-G))
- **Security settings** — refresh session list after password change; surface session fetch errors; correct iOS vs macOS labels in session user-agent parsing ([#390](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/390))

---

## [1.8.4] - 2026-07-12

### Changed

- **Marketing hero** — updated supporting line copy under the primary CTAs

---

## [1.8.3] - 2026-07-12

### Added

- **Dashboard Sentry** — optional `@sentry/nextjs` error monitoring (client, server, edge); gated on `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`; `error.tsx` / `global-error.tsx` capture; docs updated ([#385](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/385), closes [#385](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/385))

---

## [1.8.2] - 2026-07-12

### Added

- **Preferences settings** — `GET`/`PATCH /api/meta/dashboard-preferences` persist dashboard defaults (time range, table density, resolved issues, usage analytics); settings page loads and saves via server action ([#356](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/356), closes [#356](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/356))

---

## [1.8.1] - 2026-07-12

### Fixed

- **Release email ops** — shared `changelog-section` resolves `CHANGELOG.md` from the script module path (not cwd), parses dated semver section headers correctly, and the release-email workflow falls back to `origin/main` when a tag is pushed before the release merge lands ([#355](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/355))

### Changed

- **Release docs** — document release-email CHANGELOG lookup and tag/merge ordering ([#355](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/355))

---

## [1.8.0] - 2026-07-12

### Added

- **Profile settings** — `PATCH /api/auth/me` updates `displayName`; dashboard profile page loads real user data and saves via server action ([#98](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/98))

### Changed

- **Settings hub** — What's new reads `CHANGELOG.md` via `loadChangelog()`; contact support links to GitHub issues and shows platform version from API `/health`; profile and changelog nav items no longer marked coming soon ([#98](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/98))

---

## [1.7.4] - 2026-07-12

### Added

- **Production monitoring** — `docs/MONITORING.md` runbook (Sentry, uptime, on-call); `scripts/check-production-uptime.sh` external probe; GitHub Actions **Production uptime** workflow every 15 minutes on `main` ([#93](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/93))

---

## [1.7.3] - 2026-07-12

### Added

- **Registration policy** — document open vs invite-only production signup (`docs/REGISTRATION-POLICY.md`); optional `EXPECT_REGISTRATION_POLICY` check in `scripts/verify-prod-config.sh` ([#344](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/344), closes [#92](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/92))

### Changed

- **Deployment docs** — link `TELEMETRY_ALLOW_REGISTRATION` to registration policy runbook ([#344](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/344))

---

## [1.7.2] - 2026-07-11

### Added

- **Contributing** — README section pointing newcomers to `good first issue` labels ([#337](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/337))

### Changed

- **German README** — translate remaining English in screenshot captions ([#339](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/339))
- **CI** — `bugbot-review` workflow: require Cursor Bugbot only on maintainer PRs; fork/external contributor PRs pass automatically ([#340](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/340))

---

## [1.7.1] - 2026-07-09

### Changed

- **Release email ops** — document that `TELEMETRY_EMAIL_FROM` must use a verified Resend domain (`noreply@tacko.io`, not `@telemetry-tracker.com`); fail fast with setup guidance on Resend domain verification errors ([#334](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/334))

---

## [1.7.0] - 2026-07-09

### Added

- **`@telemetry-tracker/vite-plugin`** — Vite/Rollup plugin uploads `.map` files after `vite build`; optional delete from public output; documented in [docs/sdk-vite.md](docs/sdk-vite.md) ([#231](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/231))

---

## [1.6.6] - 2026-07-09

### Added

- **Production config verifier** — `scripts/verify-prod-config.sh` runs external checks for the Railway deployment checklist (health, ingest/read auth, CORS, dashboard reachability); documented in [DEPLOYMENT.md](DEPLOYMENT.md) ([#325](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/325), [#85](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/85))
- **German README** — `README.de.md` with full German translation of the project README ([#246](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/246))

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

## [1.5.0] - 2026-07-07

First release of the **v1.5.x — Analytics dashboard** milestone ([#181](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/181)).

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
