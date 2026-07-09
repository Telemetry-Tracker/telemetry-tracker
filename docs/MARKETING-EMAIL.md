# Marketing / release email list

Product update emails for the hosted cloud: footer subscribe form, registration opt-in, and a manual release send script.

## Data model

`MarketingSubscriber` stores:

| Field | Purpose |
|-------|---------|
| `email` | Unique subscriber address |
| `source` | `subscribe_form` or `registration` |
| `subscribed_at` | First subscription time |
| `unsubscribed_at` | Set on one-click unsubscribe |
| `consent_at` | Last consent timestamp (GDPR) |
| `consent_metadata` | Consent label, version, optional IP / user agent |
| `unsubscribe_token` | SHA-256 hash of opaque one-click token |

## Public API

| Endpoint | Description |
|----------|-------------|
| `POST /api/marketing/subscribe` | `{ "email": "you@example.com" }` — footer / contact form |
| `POST /api/marketing/unsubscribe` | `{ "token": "<opaque>" }` — linked from emails; dashboard `/unsubscribe?token=…` calls this |

Both routes use the public rate limit surface (`RATE_LIMIT_PUBLIC_MAX`).

## Registration opt-in

`POST /api/auth/register` accepts `marketingOptIn` (default **true** when omitted). The dashboard registration checkbox is **on by default** with explicit copy; unchecking sends `marketingOptIn: false` and **does not** add the address to the list.

## When to send (maintainer policy)

Versions use **`vX.Y.Z`** semver:

| Component | Name | Product update email |
|-----------|------|----------------------|
| **X** | Major | **Send** |
| **Y** | Minor | **Send** |
| **Z** | Patch / hotfix | **Skip** (use `--force` for exceptional user-visible hotfixes) |

Examples: `v1.5.18` → `v1.6.0` is a **minor** release (Y: 5→6). `v1.6.0` → `v1.6.1` is a **patch** hotfix (Z only).

| Release type | Send? | Notes |
|--------------|-------|-------|
| **MINOR** (Y) or **MAJOR** (X) on `main` | **Yes** | Automated on `v*.*.*` tag push via [release-email workflow](../.github/workflows/release-email.yml) |
| **PATCH** / hotfix (Z only) | **No** | Workflow skips Z-only bumps; use `--force` for exceptional user-visible hotfixes |
| Pre-release / draft | **No** | Use `--dry-run` and `--version=Unreleased` to preview copy only |

Align semver bumps with [RELEASE.md](./RELEASE.md#semver-guidance). If a release has no subscriber-relevant bullets (migrations-only, internal ops), skip the email with workflow dispatch disabled — cancel the **Release product email** run before the send step, or use a manual override only when needed.

Delivery is recorded in `MarketingReleaseEmailSend` (one row per subscriber per release version). Workflow re-runs and manual retries skip already-sent recipients, deliver to subscribers who joined after the first broadcast, and do not rotate unsubscribe tokens again for completed sends. GitHub Actions logs and a note in the GitHub Release are the operator-facing records.

### Automated send (MINOR / MAJOR tags)

Pushing a semver tag `vX.Y.Z` to GitHub triggers **Release product email** when **X** (major) or **Y** (minor) increases vs the previous tag; **Z**-only (patch/hotfix) tags are skipped:

1. Resolves the previous semver tag and compares **X** and **Y** (Z-only → skip).
2. Runs `send-release-email.ts --version=X.Y.Z --previous-version=…` with repository secrets.

Apply production migrations **before tagging** ([RELEASE.md](./RELEASE.md#3-database-migrations-production)); this workflow does not run `prisma migrate deploy` (GitHub Actions cannot reach Railway private `*.railway.internal` URLs).

Required GitHub secrets in the **`production`** environment:

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | Production Postgres **public** URL (Railway TCP proxy / public host — not `postgres.railway.internal`) |
| `RESEND_API_KEY` | Resend API |
| `TELEMETRY_EMAIL_FROM` | From address |
| `TELEMETRY_DASHBOARD_ORIGIN` | Unsubscribe / docs links (e.g. `https://telemetry-tracker.com`) |

Store these in the GitHub **`production`** environment. To retry a send without re-tagging, use **Actions → Release product email → Run workflow** with `version` and `previous_version`.

The workflow runs **after** the tag is pushed — finalize `CHANGELOG.md` on `main` **before** tagging so the email body matches the release.

### Manual send (override / backfill)

Use when automation was skipped, for one-time backfill, or for a notable PATCH with `--force`:

```bash
cd apps/api
pnpm exec tsx scripts/send-release-email.ts --dry-run --version=X.Y.Z
pnpm exec tsx scripts/send-release-email.ts --version=X.Y.Z
# Patch override (automation would skip):
pnpm exec tsx scripts/send-release-email.ts --version=X.Y.Z --previous-version=X.Y.Z-1 --force
```

Spot-check one inbox (rendering + unsubscribe link) after manual sends. Note in the GitHub Release: “Product update email sent to N subscribers on YYYY-MM-DD.”

### v1.4.2 backfill (one-time)

v1.4.2 shipped the subscriber list and release script but **no automated send ran** — subscribers have not received a product update email yet. Send once when ready:

```bash
cd apps/api
pnpm exec tsx scripts/send-release-email.ts --dry-run --version=1.4.2
pnpm exec tsx scripts/send-release-email.ts --version=1.4.2
```

Skip separate emails for v1.4.0 / v1.4.1 unless you deliberately want historical catch-up; start the cadence from v1.4.2.

## Sending a release email (MVP)

Requires Resend (`RESEND_API_KEY`, `TELEMETRY_EMAIL_FROM`) and `TELEMETRY_DASHBOARD_ORIGIN` for unsubscribe links.

```bash
cd apps/api
pnpm exec tsx scripts/send-release-email.ts --help
pnpm exec tsx scripts/send-release-email.ts --dry-run --version=1.4.2
pnpm exec tsx scripts/send-release-email.ts --version=1.4.2
```

- `--version=X.Y.Z` reads that section from `CHANGELOG.md` (repo root). Required for a live send; omit only with `--dry-run` to preview `[Unreleased]`.
- `--previous-version=X.Y.Z` skips Z-only (patch/hotfix) releases unless `--force` is set (same rule as CI).
- `--dry-run` prints subject, recipient count, and a short CHANGELOG preview without sending.
- Before each successful send, the script rotates the one-click unsubscribe token for that recipient: the hash is written **before** Resend sends so the link in the message always matches the database; failed sends restore the prior token.
- After a successful Resend delivery, a `MarketingReleaseEmailSend` row is written so retries send only to remaining subscribers (requires migration `20260708140000_marketing_release_email_send`).
- If there are **no active subscribers**, the script exits non-zero; re-run the workflow after subscribers exist.

### First production send checklist

1. Merge migration `20260703140000_marketing_subscriber` and deploy API.
2. Confirm Resend domain and `TELEMETRY_EMAIL_FROM` (see [BILLING.md](./BILLING.md)).
3. Set `TELEMETRY_DASHBOARD_ORIGIN=https://telemetry-tracker.com` on the API.
4. Finalize the target version section in `CHANGELOG.md` on `main`.
5. Run `--dry-run --version=X.Y.Z`, verify subscriber count and subject line.
6. Run with `--version=X.Y.Z` (no `--dry-run`) from a secure operator machine with production `DATABASE_URL`.
7. Spot-check inbox rendering and the unsubscribe link.

### Automation

**MINOR** (Y) and **MAJOR** (X) tags trigger [Release product email](../.github/workflows/release-email.yml) automatically. Patch/hotfix tags (Z only) are skipped. See [When to send](#when-to-send-maintainer-policy) for secrets and manual override.

## Privacy

Hosted cloud privacy policy covers product update emails, consent, and unsubscribe. Cookie policy is unchanged — marketing email is not cookie-based tracking.
