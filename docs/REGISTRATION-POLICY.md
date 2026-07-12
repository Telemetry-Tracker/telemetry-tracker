# Production registration policy

GitHub issue [#92](https://github.com/unjica/telemetry-tracker/issues/92) — decide who can sign up on the hosted cloud (`telemetry-tracker.com`) before marketing drives traffic.

## Options

| Policy | API env | Self-serve signup | Invite signup |
|--------|---------|-------------------|---------------|
| **Open** | `TELEMETRY_ALLOW_REGISTRATION=true` | Allowed (Free tier, no org until user creates one) | Allowed |
| **Invite-only / closed** | unset, `false`, or any value other than `true` | **403** after the first user row exists | Allowed |

**Bootstrap exception:** When the `User` table is empty, the first account can always register (no env var required). After that, only `TELEMETRY_ALLOW_REGISTRATION=true` keeps self-serve open.

Implementation: `apps/api/src/routes/auth.ts` — invite flow (`inviteToken`) runs **before** the open-registration gate, so team invites work in both policies.

## Production decision (2026-07-12)

**Open registration** — self-serve signup stays enabled for marketing launch.

- Production API: `TELEMETRY_ALLOW_REGISTRATION=true`
- Marketing CTAs remain on `/register` (hero, nav, pricing, docs).
- Team invites continue to work for adding members to existing orgs.

To switch to **invite-only** later: set `TELEMETRY_ALLOW_REGISTRATION=false` on the API, point CTAs to `/contact`, and verify with `EXPECT_REGISTRATION_POLICY=closed ./scripts/verify-prod-config.sh`.

## Railway configuration

On the **API** service (not dashboard):

```bash
# Open registration (production)
TELEMETRY_ALLOW_REGISTRATION=true

# Invite-only (after first admin exists)
TELEMETRY_ALLOW_REGISTRATION=false
```

Redeploy is not required beyond a normal API restart when changing the var.

**Verify:**

```bash
# Open policy (creates a throwaway probe account):
EXPECT_REGISTRATION_POLICY=open ./scripts/verify-prod-config.sh

# Closed policy — 403 passes (invite-only); 201 warns on empty DB bootstrap:
EXPECT_REGISTRATION_POLICY=closed ./scripts/verify-prod-config.sh

# After bootstrap — 201 on closed probe fails hard (registration still open):
REGISTRATION_BOOTSTRAP_COMPLETE=1 EXPECT_REGISTRATION_POLICY=closed ./scripts/verify-prod-config.sh
```

## Ops: onboarding when registration is closed

### New team via invite (standard)

1. Existing **OWNER** signs in → **Settings → Team**.
2. Enter email + role → **Add or invite**.
3. Share the invite URL (or rely on Resend email when configured).
4. Invitee opens `/register?invite=<token>`, creates account, lands in the org.

Invites expire after 7 days (`INVITE_DAYS` in `apps/api/src/routes/project-dashboard.ts`). Re-invite rotates the token.

### First production admin (bootstrap)

1. Deploy Postgres + API + dashboard; run `prisma migrate deploy`.
2. Register the first user at `/register` (allowed while DB has zero users).
3. Create organization → project → API key.
4. Set `TELEMETRY_ALLOW_REGISTRATION=false` on the API.

### Sales / contact-led signup

1. Collect email via [/contact](https://telemetry-tracker.com/contact) or sales channel.
2. An existing OWNER creates an org (or uses a dedicated “customers” org) and sends an invite.
3. Optional: OWNER creates the org first, invites customer as **OWNER** on a fresh org if you add org-creation tooling later.

There is no admin “create user without invite” API in v1 — invites are the supported path.

## Marketing alignment

When registration is **closed**, update CTAs that currently point to `/register`:

| Location | Current | Closed policy |
|----------|---------|---------------|
| Hero / nav / CTA (`hero.tsx`, `nav.tsx`, `cta.tsx`) | “Start free — no card” → `/register` | “Request access” or “Contact us” → `/contact` |
| Pricing tiers (`pricing.tsx`) | “Start free” → `/register` | “Contact us” → `/contact` (or keep Free → contact) |
| Docs hosted-cloud page | Links to `/register` | Note invite-only + contact |

The `/register` page can stay reachable for invite links; consider showing a message when self-serve is disabled (API returns `Registration is disabled`).

When registration is **open**, keep existing CTAs; ensure `TELEMETRY_ALLOW_REGISTRATION=true` on production API.

## Related scripts and tests

- `scripts/verify-prod-config.sh` — optional registration policy check (`EXPECT_REGISTRATION_POLICY`).
- `scripts/smoke-production.sh` — full E2E including self-serve register; requires **open** policy or will fail at step 2.
- `docs/RBAC.md` — registration and invite behavior.

## Acceptance checklist (#92)

- [x] Policy decided: **open registration**
- [x] `TELEMETRY_ALLOW_REGISTRATION=true` confirmed on production API (Railway)
- [x] Marketing CTAs match policy (`/register`)
- [x] Ops runbook documented (this doc)
- [x] `./scripts/verify-prod-config.sh` passes with `EXPECT_REGISTRATION_POLICY=open` — verified 2026-07-12 (14 PASS)
