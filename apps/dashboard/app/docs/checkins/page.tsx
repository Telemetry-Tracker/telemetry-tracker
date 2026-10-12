import type { Metadata } from "next";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
export const metadata: Metadata = { title: "Cron check-ins", description: "Monitor scheduled jobs with secret URLs, cron time zones and runtime deadlines." };
export default function CheckInsDocsPage() {
  return <DocsArticle title="Cron and background-job check-ins" lede={<p>Create a monitor in Dashboard → Check-ins, then send a heartbeat when your job finishes. Free includes 5 monitors per project, Pro 50, Business 500. Pings do not consume ingest quota.</p>}>
    <h2>Secret URLs</h2><p>Owners and editors can view and rotate URLs. Viewers see status and history only. Store URLs in CI secrets or environment variables, never commit them. Rotation immediately invalidates the old URL.</p>
    <h2>Signals</h2><p>GET or POST to the URL means success. Append /start, /fail or an exit code (0–255, where 0 is success). Add ?rid=UUID to all signals for the same run for safe retries and overlapping jobs. Bodies are ignored and no IP addresses are stored. HEAD and known chat previews/search bots are ignored.</p>
    <pre><code>{'curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL"'}</code></pre>
    <h2>Schedules and deadlines</h2><p>Intervals are at least five minutes. Cron uses five fields and an IANA time zone, default UTC. Spring-forward missing times move to the next valid hour; the repeated fall-back wall-clock hour runs once, following cron-parser. Select the same zone as your scheduler. A completion up to 60 seconds early (or grace if smaller) satisfies the approaching slot. Grace is added to the next due time. Detection can take another evaluator period (five minutes). Optional maximum runtime requires /start and times out runs without a finish. New/resumed monitors arm on the first signal.</p>
    <p>Failures and misses send one down alert per outage; success sends one recovery. Paused monitors keep history without changing status. The evaluator defers overdue work after a stale sweep or once during a global ping gap to reduce false alerts during TT outages.</p>
    <h2>Node and Vercel Cron</h2><pre><code>{`import { withCheckIn } from '@telemetry-tracker/node';
await withCheckIn(process.env.TT_CHECKIN_URL!, () => backup(), {
  monitorName: 'Nightly backup',
});`}</code></pre><p>The helper sends start/ok/fail, preserves job results and reports thrown errors with monitor context when the SDK is initialized. Check-in network failures do not fail the job. For Vercel, protect your cron route with CRON_SECRET before invoking the helper; store TT_CHECKIN_URL in environment secrets and use UTC for the monitor.</p>
    <h2>GitHub Actions</h2><p>Use a repository or environment secret and a UTC schedule. A final step with if: always() can send /0 on success or /fail otherwise; use the same UUID in start and finish.</p>
    <pre><code>{`env:
  TT_CHECKIN_URL: \${{ secrets.TT_CHECKIN_URL }}
steps:
  - run: ./backup.sh
  - if: always()
    env:
      JOB_STATUS: \${{ job.status }}
    run: |
      suffix=fail
      if [ "$JOB_STATUS" = success ]; then suffix=0; fi
      curl -fsS --retry 3 --retry-all-errors -m 10 "$TT_CHECKIN_URL/$suffix"`}</code></pre>
    <h2>Limits and self-hosting</h2><p>Limits are 12 requests/minute per monitor and 600/minute per project, per API process. History follows plan retention and keeps at most 1,000 rows per monitor. Self-hosters must set CHECKIN_ENCRYPTION_KEY (32 random bytes as hex), preserve it with database backups, and run node dist/jobs/run-alert-rules-evaluator.js every five minutes. Run the existing webhook worker for webhook/chat alerts. /health and the dashboard report evaluator health. Set CHECKIN_PUBLIC_BASE_URL on the dashboard when API_URL is internal. Redact URLs in reverse proxy/CDN logs.</p>
    <p><a href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/CHECK-INS.md">Complete curl, GitHub Actions and authenticated Vercel recipes and operational details</a></p>
  </DocsArticle>;
}
