# Cron and background-job check-ins

Create monitors in **Dashboard → Check-ins**. Choose a fixed interval (minimum
300 seconds) or a five-field cron expression and an IANA time zone (UTC by
default). Free allows 5 monitors per project, Pro 50, Business 500, using the
existing effective billing tier. Pings never consume ingest units, even when
the project's ingest quota is exhausted.

## Secrets and endpoint

Owners and editors (TT's admin role) can view and rotate a monitor's URL;
viewers can only see status and history. Store the URL in CI secrets or an
environment variable. Never commit it, echo it, or paste it into public chat.
Rotation invalidates the old URL immediately; update every caller afterwards.
The secret grants ping access only, not access to project data.

Recommended: keep the token out of proxy/CDN request URLs by sending
`X-TT-Checkin-Token: ttc_...` (or `Authorization: Bearer ttc_...`) with
`GET`, `POST`, or `HEAD /checkin` or `/checkin/<action>`:

```sh
curl -fsS -X POST -H "X-TT-Checkin-Token: $TT_CHECKIN_TOKEN" "$TT_API_URL/checkin"
```

Path-token URLs remain supported, but appear verbatim in proxy/CDN logs;
application redaction cannot remove them from infrastructure logs.
`GET` or `POST /checkin/<secret>` reports success. Append `/start`, `/fail`, or
`/<exit code>` (0–255; 0 is success). Optional `?rid=<UUID>` pairs overlapping
runs and makes retries idempotent. Send the same UUID for start and finish.
A terminal result for a run cannot be changed by retries. Without a run ID,
identical kinds within 60 seconds are ignored and only one open run is tracked.
Use run IDs for concurrent jobs. The server uses receive time, never client time.

Responses are small plain text: 200 `OK`, 404 unknown/rotated/deleted token or
unsupported suffix, 400 invalid run ID, 429 rate limit. Responses are not cacheable.
Bodies are ignored; no request body, IP address or user agent is stored in
check-in records. HEAD and known preview/crawler agents (Slack, Discord,
Telegram, Teams, WhatsApp, social previews and search bots) are no-ops, so
unfurling a URL does not report success. Use curl or a normal server HTTP client.

Limits: 12 requests/minute per monitor and 600/minute per project; the ping
surface also has a 600/minute per-IP limiter. These are per API process, like
existing ingest throttling. Multiple replicas require a shared limiter for a
strict cluster-wide ceiling. Prefer retries with a run ID.

## Schedules, grace and runtime

New monitors are unarmed until their first start, success or failure. Intervals
are measured from receipt of a completion. Cron schedules follow the selected
time zone using cron-parser's DST behavior: spring-forward nonexistent times
move into the next valid hour; repeated fall-back hours use the parser's single
wall-clock occurrence. Match the time zone used by your actual scheduler.
Cron minute fields must have at least five minutes between values, including
hour wrap; dense schedules are rejected even if other fields restrict dates.

A cron completion satisfies the latest scheduled slot; a ping up to 60 seconds
early (or grace, if smaller) satisfies the approaching slot. Extra pings for an
already satisfied slot do not skip additional slots. Grace is added to the next
expected time. A missed check-in is one whose deadline has elapsed. Detection
can take up to another five minutes after grace, due to the evaluator cadence.
A start arms monitoring and, if configured, creates a separate runtime deadline.
A start without finish can therefore produce TIMEOUT or MISSED. Finishing one
run does not cancel another run's timeout. Explicit failure/exit != 0 is immediate.

Each outage sends one down alert and the next success sends one recovery through
in-app notifications and the selected existing email/webhook channels (Slack,
Discord, Teams, Telegram, HTTPS webhooks). User email preferences still apply.
No repeated reminders. Pause records history but suppresses monitoring. Resume
returns to New and requires a fresh ping; existing runs are closed on pause/resume.
Editing a schedule resets its deadline without fabricating a recovery.

If the evaluator was missing/stale (over two intervals), overdue deadlines are
deferred for one sweep period. A platform-wide gap with no recent check-ins also
gets one deferral per gap. Persistent gaps eventually alert; this guard reduces
false bursts but cannot distinguish every platform outage from simultaneous job
failures. Alert intents are committed with state changes and retried by the
evaluator using the existing alert-event dedupe.

## curl

```sh
# TT_CHECKIN_URL is a secret environment variable. Avoid shell tracing (set -x).
RID=$(node -e 'console.log(require("crypto").randomUUID())')
curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL/start?rid=$RID"
./backup.sh
code=$?
curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL/$code?rid=$RID"
exit "$code"
```

Do not enable `set -e` before capturing the job's exit code. For a simple success
heartbeat: `curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL"`.

## GitHub Actions

Store the URL as repository/environment secret `TT_CHECKIN_URL`. GitHub cron
schedules use UTC; choose UTC for the monitor too and allow for scheduler delays.

```yaml
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  backup:
    runs-on: ubuntu-latest
    env:
      TT_CHECKIN_URL: ${{ secrets.TT_CHECKIN_URL }}
    steps:
      - uses: actions/checkout@v4
      - name: Start
        run: |
          RID=$(cat /proc/sys/kernel/random/uuid)
          echo "TT_RUN_ID=$RID" >> "$GITHUB_ENV"
          curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL/start?rid=$RID"
      - run: ./backup.sh
      - name: Finish
        if: always()
        env:
          JOB_STATUS: ${{ job.status }}
        run: |
          suffix=fail
          if [ "$JOB_STATUS" = success ]; then suffix=0; fi
          curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL/$suffix?rid=$TT_RUN_ID"
```

## Node helper and Vercel Cron

```ts
import { withCheckIn } from '@telemetry-tracker/node';
await withCheckIn(process.env.TT_CHECKIN_URL!, () => backup(), {
  monitorName: 'Nightly backup',
});
```

The helper sends start/ok/fail with a shared UUID, retries twice with a five-second
request timeout, preserves return values and rethrows job errors. Network failures
do not fail the job. If the SDK is initialized, thrown errors are reported with
`checkin` (monitor name) and `checkin_run_id` context. The helper uses header authentication by default for valid token URLs; pass
`tokenTransport: "url"` to retain path authentication. No slug auth.

For Vercel, put `TT_CHECKIN_URL` and `CRON_SECRET` in project environment secrets.
Configure `vercel.json` with `{"crons":[{"path":"/api/backup","schedule":"0 3 * * *"}]}`
and monitor that UTC schedule. Protect the route before signaling a check-in:

```ts
import { withCheckIn } from '@telemetry-tracker/node';
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET ||
      request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  await withCheckIn(process.env.TT_CHECKIN_URL!, () => backup(), {
    monitorName: 'Nightly backup',
  });
  return new Response('OK');
}
```

## Self-hosting

Apply the additive Prisma migration. Set **CHECKIN_ENCRYPTION_KEY** on the API to
32 random bytes encoded as 64 hex characters (`openssl rand -hex 32`), managed
as a deployment secret and backed up with the database. AES-256-GCM encrypts the
viewable URL; SHA-256 of the 256-bit random token provides indexed authentication.
Losing/changing this encryption key makes existing URLs unreadable in the dashboard;
rotate affected monitor URLs afterwards. Do not reuse an ingest key or a public key.

Set dashboard **CHECKIN_PUBLIC_BASE_URL** to the publicly reachable API origin
if `API_URL` is an internal address. Otherwise `API_URL` is used for copied URLs.

The evaluator is **required** for missed/runtime detection: schedule
`node dist/jobs/run-alert-rules-evaluator.js` every five minutes (`*/5 * * * *`)
from the API image, or run its `--loop` mode. It needs DATABASE_URL and the same
RESEND_API_KEY, TELEMETRY_EMAIL_FROM, TELEMETRY_DASHBOARD_ORIGIN settings used for
existing alerts. Run the existing webhook worker for chat/webhook delivery.
`/health` exposes `alert_rules_evaluator` (ok/stale/never); the dashboard shows a
warning when it is unavailable. The nightly retention job enforces plan retention
(14/90/365 days) and a cap of 1,000 check-in rows per monitor.

Fastify and operator Sentry redact check-in tokens, including strings outside the
request URL. Configure your reverse proxy/CDN and external access logs to redact
`/checkin/*` too; application filtering does not control infrastructure logs.
