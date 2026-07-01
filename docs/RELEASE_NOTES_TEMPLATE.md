# GitHub Release notes template

Use this when publishing a semver tag on `main`. **CHANGELOG.md** is the full record; the GitHub Release is a short summary for deployers and hosted users.

Copy this file, replace placeholders, then publish:

```bash
VERSION=1.2.0
PREVIOUS=1.1.0
cp docs/RELEASE_NOTES_TEMPLATE.md /tmp/release-notes-v${VERSION}.md
# Edit /tmp/release-notes-v${VERSION}.md — fill every section below
gh release create "v${VERSION}" \
  --title "Telemetry Tracker v${VERSION}" \
  --notes-file "/tmp/release-notes-v${VERSION}.md"
```

Delete sections that do not apply (e.g. no new migrations → remove the migrations list; no SDK change → remove SDK section).

---

## Highlights

<!-- 3–5 bullets from CHANGELOG Added/Changed — user-facing only -->

- **Feature name** — one-line summary
- **Another feature** — one-line summary

## Upgrade (self-hosted)

<!-- Set PREVIOUS to the last semver tag users may upgrade from -->

From v{{PREVIOUS}}, run migrations after deploy:

```bash
pnpm --filter api exec prisma migrate deploy
```

New migrations in this release:

<!-- List folder names from apps/api/prisma/migrations/ since the previous tag, or "None." -->

- `YYYYMMDDHHMMSS_migration_name`

<!-- If no migrations: replace the list with "None — no database changes in this release." -->

## Environment variables

<!-- Omit this section if nothing new. List API and dashboard vars with one line each. -->

| Variable | Service | Required | Notes |
|----------|---------|----------|-------|
| `EXAMPLE_VAR` | API | Yes | What it does |

## SDK compatibility

<!-- Omit if platform release does not change ingest/SDK contract -->

Platform v{{VERSION}} works with `@tacko/telemetry-*` **>= X.Y.Z**.

If SDK packages were published, link npm versions here.

## Breaking changes

<!-- Omit if none. Otherwise bullet list with migration path. -->

- None.

## Full changelog

See [CHANGELOG.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/CHANGELOG.md#{{VERSION_ANCHOR}}).

<!-- VERSION_ANCHOR = markdown heading anchor, e.g. 120---2026-08-15 for ## [1.2.0] - 2026-08-15 -->

---

## Example (v1.1.0)

<details>
<summary>Filled example — click to expand</summary>

## Highlights

- **Notifications v1** — in-app bell, read state, preferences, and transactional email (billing, quota, team, errors)
- **Light theme** — dark (default), light, and system; Appearance settings page
- **Flexible time ranges** — Sentry-style picker across overview and lists
- **Dashboard performance** — bootstrap API and streaming layout shell
- **Nav scope pickers** — project/app switchers with pinned, recent, and search

## Upgrade (self-hosted)

From v1.0.0, run migrations after deploy:

```bash
pnpm --filter api exec prisma migrate deploy
```

New migrations:

- `20260628120000_overview_perf_indexes`
- `20260701120000_user_notification_preferences`
- `20260701130000_notification_read_and_email_log`
- `20260701140000_organization_invite_email_sent_at`
- `20260701150000_organization_invite_email_sent_token`

## SDK compatibility

Platform v1.1.x works with `@tacko/telemetry-*` **>= 1.2.0**.

## Full changelog

See [CHANGELOG.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/CHANGELOG.md#110---2026-07-01).

</details>
