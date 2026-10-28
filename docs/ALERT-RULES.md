# Alert rules

Configurable notification rules per project ([#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493); milestone **v1.15.x — Alert Rules**).

## Separation of concerns

| Capability | Owns | Does not own |
| --- | --- | --- |
| **Alert Rules** (this doc / #493) | When to fire: `Condition[]` (AND), thresholds/windows, cooldown dedupe, opaque `destinationIds` bindings | Provider send logic, channel CRUD, email templates |
| **Notifications** (v1.14 / [#492](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/492)) | Delivery: Notification Center, email fan-out, Slack/Discord/Teams/Telegram/webhooks via `fireProjectAlert` / enqueue workers | Rule authoring / condition evaluation |

Rules **must not** embed provider-specific send paths. On match they call into existing dispatch (`fireProjectAlert`), which resolves destination ids to email and/or `ProjectWebhook` deliveries.

## Built-in spike / quota (#535)

Built-in error-spike and quota alerts are **system-managed `AlertRule` rows** (`source=SYSTEM`), not a forever-parallel path.

| Built-in control | `system_kind` | `migration_key` | Condition representation | Fire (`AlertEvent.rule`) | Dedupe |
| --- | --- | --- | --- | --- | --- |
| Error spike | `ERROR_SPIKE` | `builtin:error_spike` | `BUILTIN_ERROR_SPIKE` (threshold, windowMinutes) | `ERROR_SPIKE` | `alert:error_spike:{projectId}:{windowMinutes}:{bucket}` |
| Quota warning | `QUOTA_WARNING` | `builtin:quota_warning` | `BUILTIN_QUOTA_WARNING` (nearPercent) | `QUOTA_NEAR` | `quota:near:{projectId}:{YYYY-MM}` |
| Quota exceeded | `QUOTA_EXCEEDED` | `builtin:quota_exceeded` | `BUILTIN_QUOTA_EXCEEDED` | `QUOTA_EXCEEDED` | `quota:exceeded:{projectId}:{YYYY-MM}` |

`BUILTIN_*` condition types are intentionally **not** evaluated by the custom AlertRule engine (unknown → skipped). That keeps mixed-version pods from firing SYSTEM rows as `ALERT_RULE` with different dedupe keys.

### What maps directly vs special handling

| Setting | Maps to |
| --- | --- |
| `errorSpike.enabled` / `threshold` / `windowMinutes` | SYSTEM `ERROR_SPIKE` rule |
| `quota.enabled` / `nearPercent` | SYSTEM `QUOTA_WARNING` rule |
| Quota exceeded | Always-on SYSTEM `QUOTA_EXCEEDED` (not toggled by `quota.enabled`) |
| Email recipients / roles | Still on `Project.alert_settings.email` (not an AlertRule condition) |
| Destinations | Built-in fires **omit** `destinations` → legacy “email + all enabled webhooks”. SYSTEM rows store a `project-email` placeholder only. |
| Cooldown | Spike/quota use **legacy AlertEvent dedupe keys**, not `last_fired_at` claims (preserves pre-migration idempotency) |

### Dual-write (transitional)

- **Canonical for spike/quota thresholds:** SYSTEM `AlertRule` rows.
- **Projection:** `Project.alert_settings` JSON is still written on PATCH and read for email settings / mixed-version readers.
- **Dashboard UX model:** built-in Error spike / Ingest quota controls edit SYSTEM rules via `PATCH /api/project/alert-settings` (dual-write). Custom rules UI lists **CUSTOM** rules only.
- **Custom CRUD** rejects PATCH/DELETE on SYSTEM rules (403). SYSTEM rows do not count toward `MAX_ALERT_RULES`.
- **Custom evaluators** (`maybeEvaluateAlertRules` / scheduled job) skip `source=SYSTEM` so they cannot double-fire with `ALERT_RULE` + `alert:rule:…` keys.

### Migration / rollout

1. Deploy schema migration `20260718140000_alert_rule_system_builtin` (`source`, `system_kind`, `migration_key`) **with this API version** (CUSTOM-only list/evaluator filters).
2. Prefer finishing the API rollout before mass-creating SYSTEM rows. SYSTEM conditions use `BUILTIN_*` types that older evaluators **skip** as unknown, so mixed-deploy dual-fire via `ALERT_RULE` is avoided even if rows appear early.
3. Optional explicit backfill (idempotent) after pods are on this version:

```bash
pnpm --filter api builtin-alert-rules-backfill
pnpm --filter api builtin-alert-rules-backfill -- --dry-run
```

4. SYSTEM rows are also created/updated on `PATCH /api/project/alert-settings` (dual-write). Reads do **not** create rows (avoids clobbering concurrent writes).
5. Mixed deploy: old instances fire from `alert_settings` with legacy dedupe keys; new instances prefer SYSTEM rows when present, same keys → `AlertEvent` unique constraint prevents duplicate notifications for the built-in path.
6. Rollback: re-deploy previous API; SYSTEM rows are skipped by old custom evaluators (`BUILTIN_*` unknown); `alert_settings` JSON still holds thresholds.
7. Failed projects: backfill logs `FAIL project=…` and increments `failures`; re-run is safe.
8. Follow-up: remove spike/quota fields from `alert_settings` once dual-write is no longer needed (track separately; parent [#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493) stays open).

## Model

| Field | Purpose |
| --- | --- |
| `conditions` | JSON **array** of condition objects — **AND** semantics (every *known* condition must match) |
| `destination_ids` | JSON array of **opaque** destination ids (not `email`/`slack`/… provider enums) |
| `cooldown_minutes` | Minimum minutes between successful fires (enforced via `last_fired_at` for CUSTOM rules) |
| `last_fired_at` | Set atomically on fire claim; null until the first successful claim |
| `source` | `CUSTOM` (user) or `SYSTEM` (built-in spike/quota) |
| `system_kind` / `migration_key` | SYSTEM identity; unique per `(project_id, migration_key)` |
| `enabled` / `deleted_at` | Toggle and soft-delete |

### Conditions (`Condition[]`)

Supported kinds (#534):

| Type | Meaning | Path |
| --- | --- | --- |
| `ERROR_COUNT` | Error occurrences ≥ threshold in window | Ingest |
| `ERROR_RATE` | `(errors / sessions) × 100` ≥ threshold percent (requires sessions &gt; 0) | Ingest + scheduled |
| `SESSION_DROP` | Sessions dropped ≥ percent vs previous equal window | Scheduled |
| `NEW_ERROR_GROUP` | ≥1 `ErrorGroup` with `first_seen` in window | Ingest |
| `AFFECTED_USERS` | Distinct non-null `user_id` on occurrences ≥ threshold | Ingest |
| `QUOTA_PERCENT` | Monthly ingest usage ≥ percent of plan limit | Scheduled |
| `NO_EVENTS` | Zero `Event` rows in window — optionally only events named `eventName` ([business heartbeats](#business-heartbeats)) | Scheduled |
| `HEARTBEAT` | Zero events, sessions, and error occurrences in window | Scheduled |

Optional `environment` (where present) filters ingest/environment-scoped rows — for errors this is `ErrorOccurrence.environment` (set at ingest), not the mutable last-seen tag on `ErrorGroup`.

```json
{
  "conditions": [
    {
      "type": "ERROR_COUNT",
      "threshold": 25,
      "windowMinutes": 15,
      "environment": "production"
    },
    {
      "type": "HEARTBEAT",
      "windowMinutes": 30
    }
  ]
}
```

Multiple conditions are ANDed. Unknown / unsupported `type` values are **skipped** (diagnostic log); they never crash evaluation or fail the AND group. If no supported conditions remain after filtering, the rule does not fire.

### Destinations (opaque ids)

```json
{
  "destinationIds": ["project-email", "<ProjectWebhook uuid>", "…"]
}
```

| Id | Resolved by Notifications to |
| --- | --- |
| `project-email` | Project alert email fan-out (`fireProjectAlert` email path) |
| `ProjectWebhook.id` | That delivery channel (Slack / Discord / Teams / Telegram / generic webhook — provider is on the webhook row, not the rule) |

Rules store ids only. Provider awareness lives in Notifications / Delivery channel configuration.

## Evaluation

### Ingest-triggered

On successful error ingest:

1. `maybeNotifyErrorSpike` — SYSTEM error-spike rule (legacy `ERROR_SPIKE` + dedupe)
2. `maybeEvaluateAlertRules` — CUSTOM rules with ingest conditions
3. `maybeNotifyQuotaAlerts` — SYSTEM quota rules (legacy `QUOTA_*` + monthly dedupe)

Matching **custom** rules call `fireProjectAlert` with `rule: ALERT_RULE` after resolving `destinationIds` → `{ email, webhookIds }` at the Notifications boundary.

### Scheduled evaluator

Conditions that are not naturally ingest-triggered (`HEARTBEAT`, `NO_EVENTS`, `SESSION_DROP`, `QUOTA_PERCENT`, and `ERROR_RATE`) are evaluated by the scheduled job for **CUSTOM** rules only:

```bash
pnpm --filter api alert-rules-evaluator
# production: node dist/jobs/run-alert-rules-evaluator.js
```

- One sweep then exit (Railway cron) by default; `--loop` sleeps between ticks.
- Cadence is configured in **one place**: `ALERT_RULES_SCHEDULE_INTERVAL_MINUTES` (default **5**; constant `ALERT_RULES_SCHEDULE_INTERVAL_MINUTES` in `apps/api/src/lib/alert-rules.ts`).
- Soft-deleted projects and soft-deleted organizations are skipped (same gate as ingest API-key auth).
- Cooldown is elapsed time since `last_fired_at` (atomic claim so overlapping sweeps cannot double-fire). `alert:rule:{id}:{claimedAtMs}` is only the `AlertEvent` idempotency key after a successful claim.
- Coexists with ingest evaluation: schedule-only rules are skipped on ingest; ingest-only rules are skipped on the schedule path; mixed rules are evaluated on both paths with full AND semantics.

See [RAILWAY.md](./RAILWAY.md#alert-rules-evaluator-cron).

## API

- `GET/POST /api/project/alert-rules`
- `PATCH/DELETE /api/project/alert-rules/:ruleId`
- `GET/PATCH /api/project/alert-settings` — built-in spike/quota (+ email); dual-writes SYSTEM rules

Create body shape:

```json
{
  "name": "Production error spike",
  "conditions": [{ "type": "ERROR_COUNT", "threshold": 25, "windowMinutes": 15 }],
  "destinationIds": ["project-email"],
  "cooldownMinutes": 15
}
```

Editor/owner required for mutations (same as alert settings / webhooks). Cap: `MAX_ALERT_RULES` (20) **CUSTOM** rules per project.

## Dashboard

Alerts → **Custom rules**: create, **edit**, enable/disable, remove; multi-condition editor (AND, up to `MAX_CONDITIONS_PER_RULE`); bind opaque destination ids (email + Delivery channels) with clear copy that Notifications owns delivery. The form authors **`ERROR_COUNT`** and **`NO_EVENTS`** ("No events (heartbeat)": event name, window in whole hours 1–24, environment). Other kinds from the API — and `NO_EVENTS` windows that are not whole hours — are listed/summarized and can be toggled or removed, but are edited via the API.

## Business heartbeats

Error tracking cannot see a flow that silently stops: the verification email is never sent, a webhook returns 200 but skips the work, a nightly job never runs. Emit a custom event when the flow **succeeds**, then alert when that event has not arrived for a while.

1. Track the success:

   ```ts
   import { trackEvent } from "@telemetry-tracker/node"; // or /next, /react-native

   trackEvent("signup_verified");            // after the user confirms their email
   trackEvent("stripe_webhook_processed");   // after the handler actually did the work
   trackEvent("daily_report_finished");      // last line of the nightly job
   ```

2. Alerts → Custom rules → condition type **No events (heartbeat)**, the exact event name, and **No event for (hours)**. Or via the API:

   ```json
   {
     "name": "Signups stopped verifying",
     "conditions": [
       { "type": "NO_EVENTS", "eventName": "signup_verified", "windowMinutes": 360, "environment": "production" }
     ],
     "destinationIds": ["project-email"],
     "cooldownMinutes": 360
   }
   ```

Examples: `signup_verified` with 6–12 h for a small app; `stripe_webhook_processed` with a window a few times your normal gap between payments; `daily_report_finished` with 24 h (the maximum — see limits).

- `eventName` is optional, trimmed, max 200 characters and matched **exactly** against the event name. Without it the rule keeps the original "no events at all" behaviour.
- The alert names the event (`no "signup_verified" events in the last 6 hours in production`) and links to the Events page filtered to that name.
- **Pick the window from real traffic.** It must be comfortably longer than the normal gap between those events, or a quiet night will alert. Check the Events page for the event's typical frequency first.
- **Limits:** the window is at most **24 hours** (`windowMinutes` 5–1440; the dashboard uses whole hours 1–24), so a once-a-day job leaves little slack. The rule needs the [scheduled evaluator](#scheduled-evaluator). There is **no recovery notification**: while the event stays missing the rule fires again every cooldown, and it simply stops when events return. The dashboard defaults a heartbeat to a 6-hour window and a cooldown equal to the window. For job deadlines with down/recovery states, use [check-ins](./CHECK-INS.md) instead.

Alerts → **Error spike** / **Ingest quota**: edit SYSTEM AlertRule rows via alert-settings (not listed under Custom rules).

## Milestone slices (v1.15.x)

Parent vision: [#493](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/493) (prefer leaving parent open as living roadmap). Milestone line shipped through at least **v1.15.5**; prefer small reviewable PRs over a mega-ship.

| Slice | Issue | Status |
| --- | --- | --- |
| Foundation (this model + ERROR_COUNT + MVP UI) | [#532](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/532) / [PR #531](https://github.com/Telemetry-Tracker/telemetry-tracker/pull/531) | Shipped (v1.15.0) |
| Dashboard multi-condition / edit UX | [#533](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/533) | Shipped (v1.15.2) |
| Additional conditions + scheduled evaluation | [#534](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/534) | Shipped (v1.15.2) |
| Integrate built-in spike/quota into AlertRule | [#535](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/535) | Shipped (v1.15.2) |
| Release v1.15.0 | [#536](https://github.com/Telemetry-Tracker/telemetry-tracker/issues/536) | Shipped |
