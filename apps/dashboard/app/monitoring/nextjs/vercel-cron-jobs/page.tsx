import Image from "next/image";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import { breadcrumbJsonLd, marketingGuideMetadata, webPageJsonLd } from "@/lib/marketing-guide-metadata";

const PATH = "/monitoring/nextjs/vercel-cron-jobs";
const ORIGIN = "https://telemetry-tracker.com";
const TITLE = "Monitor Vercel cron jobs: get alerted on missed runs and see why they failed";
const DESCRIPTION = "Vercel doesn't retry or alert on failed cron jobs, and Hobby logs last 1 hour. Add check-ins plus error reporting to Next.js crons, with code. Free plan.";
const FAQ = [
  { question: "Does Vercel alert me when a cron job fails?", answer: "No. Vercel does not send alerts or retry failed cron invocations. You need to add your own monitoring." },
  { question: "Why are there no logs for my cron run?", answer: "Vercel cron invocations can be dropped (best-effort delivery), redirected by middleware or trailingSlash config, or served from cache. Hobby runtime logs are kept for only 1 hour; Pro keeps them for 1 day." },
  { question: "What grace period should I use on Hobby?", answer: "Hobby crons fire anywhere in the scheduled hour (±59 minutes). For a daily cron, use at least 60 minutes plus worst-case runtime. For example, 70 minutes if your job usually finishes in under 10 minutes." },
  { question: "Can I monitor a cron that runs every minute?", answer: "Not one-to-one with Telemetry Tracker. A TT monitor needs at least 5 minutes between occurrences, so a per-minute cron cannot map one-to-one to a monitor." },
  { question: "Will local runs trigger my production monitor?", answer: "No, if you leave TT_CHECKIN_URL unset in development and preview environments. Vercel crons only run on production deployments, and withCheckIn skips pings when the URL is not set." },
  { question: "Is this real-time?", answer: "No. Missed runs are detected after the grace period plus up to one evaluator period (about 5 minutes). Timeouts are detected after max runtime plus up to one evaluator period. Explicit failures alert within seconds." },
];

export function generateMetadata() {
  const metadata = marketingGuideMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });
  return {
    ...metadata,
    alternates: { canonical: `${ORIGIN}${PATH}` },
    openGraph: { ...metadata.openGraph, url: `${ORIGIN}${PATH}` },
  };
}

export default function VercelCronJobsPage() {
  return (
    <>
      <GuideJsonLd data={[
        webPageJsonLd({ origin: ORIGIN, path: PATH, name: TITLE, description: DESCRIPTION }),
        breadcrumbJsonLd(ORIGIN, [{ name: "Home", path: "" }, { name: "Next.js monitoring", path: "/monitoring/nextjs" }, { name: "Vercel cron jobs", path: PATH }]),
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
      ]} />
      <MarketingGuideLayout kicker="Vercel cron monitoring" title={TITLE} lede={<p>Vercel runs your cron, but it doesn&apos;t retry a failed run or tell you about it, and a dropped invocation leaves no log. On Hobby, the logs that would explain a failure are gone after an hour. We&apos;ll set up two signals per cron: a check-in that alerts when a run is missed, fails or hangs, and an error report that keeps the reason.</p>} updated="2026-10">
        <h2>How Vercel cron jobs fail without telling you</h2>
        <p>Vercel cron jobs can fail silently in several ways:</p>
        <ul>
          <li><strong>Dropped invocation:</strong> Vercel delivery is best effort; a dropped run leaves no runtime log. <em>No config fix; needs an alert.</em></li>
          <li><strong>Redirect from middleware or trailingSlash:</strong> Vercel does not follow 3xx responses and does not log them. <em>Fix: check middleware and trailingSlash config.</em></li>
          <li><strong>Cached response:</strong> A cached response is not logged in cron runs. <em>Fix: set <code>dynamic = &quot;force-dynamic&quot;</code> in the route handler.</em></li>
          <li><strong>CRON_SECRET mismatch:</strong> Your route returns 401. <em>Fix: check that the Authorization header matches <code>CRON_SECRET</code>.</em></li>
          <li><strong>Thrown error or maxDuration timeout:</strong> Vercel does not retry. <em>No config fix; needs an alert.</em></li>
          <li><strong>Handler returns 200 without doing the work:</strong> The job catches its own errors and returns success. <em>Needs status-aware monitoring.</em></li>
        </ul>
        <p>Only the first three need a fix in config. All of them need an alert.</p>

        <h2>What you need: a check-in and the error</h2>
        <p>Heartbeat ping services catch missed runs, but the error and its stack aren&apos;t stored anywhere that outlives the 1-hour log retention on Hobby. Here&apos;s what each approach gives you:</p>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-border">
            <thead>
              <tr className="bg-muted">
                <th className="border border-border px-4 py-2 text-left">Signal</th>
                <th className="border border-border px-4 py-2 text-left">Vercel logs</th>
                <th className="border border-border px-4 py-2 text-left">Heartbeat ping</th>
                <th className="border border-border px-4 py-2 text-left">Check-in + error tracking</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-4 py-2">Missed run</td>
                <td className="border border-border px-4 py-2">No log if dropped</td>
                <td className="border border-border px-4 py-2">Alert</td>
                <td className="border border-border px-4 py-2">Alert</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Thrown error</td>
                <td className="border border-border px-4 py-2">Yes, for 1 hour (Hobby)</td>
                <td className="border border-border px-4 py-2">Alert</td>
                <td className="border border-border px-4 py-2">Alert + error with stack</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">maxDuration timeout</td>
                <td className="border border-border px-4 py-2">Yes, for 1 hour (Hobby)</td>
                <td className="border border-border px-4 py-2">Alert</td>
                <td className="border border-border px-4 py-2">Alert (no error report)</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Reason kept after 1 h on Hobby</td>
                <td className="border border-border px-4 py-2">No</td>
                <td className="border border-border px-4 py-2">No</td>
                <td className="border border-border px-4 py-2">Yes (14 days on Free)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Set it up in Next.js (App Router)</h2>
        <p>Install the Node SDK (version 1.4.2 or later), which includes <code>withCheckIn</code> and <code>flush</code>:</p>
        <CodeBlock code={`pnpm add @telemetry-tracker/node
# or
npm install @telemetry-tracker/node`} lang="bash" caption="Install the Node SDK" />

        <h3>Create one monitor per vercel.json entry</h3>
        <p>In Telemetry Tracker, open your project and go to <strong>Check-ins</strong>. Click <strong>Create monitor</strong> and fill in:</p>
        <ul>
          <li><strong>Monitor name:</strong> the same name you&apos;ll use in <code>withCheckIn</code> (e.g. <code>sync-invoices</code>).</li>
          <li><strong>Schedule:</strong> copy the cron expression from <code>vercel.json</code> exactly. Use five fields (minute, hour, day, month, day-of-week).</li>
          <li><strong>Time zone:</strong> UTC (Vercel crons run in UTC).</li>
          <li><strong>Grace period:</strong> see the settings table below for Hobby vs Pro guidance.</li>
          <li><strong>Max runtime:</strong> set it a little above your route&apos;s <code>maxDuration</code> (e.g. <code>maxDuration</code> + 60 seconds).</li>
        </ul>
        <p>After creating the monitor, copy its secret URL.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-border">
            <thead>
              <tr className="bg-muted">
                <th className="border border-border px-4 py-2 text-left">Vercel plan / schedule</th>
                <th className="border border-border px-4 py-2 text-left">TT schedule</th>
                <th className="border border-border px-4 py-2 text-left">Time zone</th>
                <th className="border border-border px-4 py-2 text-left">Grace</th>
                <th className="border border-border px-4 py-2 text-left">Max runtime</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-4 py-2">Hobby, <code>0 5 * * *</code> (fires 05:00–05:59)</td>
                <td className="border border-border px-4 py-2">Cron <code>0 5 * * *</code></td>
                <td className="border border-border px-4 py-2">UTC</td>
                <td className="border border-border px-4 py-2">≥ 60 min + worst-case runtime (e.g. 70 min)</td>
                <td className="border border-border px-4 py-2"><code>maxDuration</code> + 60 s</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Pro, <code>*/10 * * * *</code></td>
                <td className="border border-border px-4 py-2">Cron <code>*/10 * * * *</code></td>
                <td className="border border-border px-4 py-2">UTC</td>
                <td className="border border-border px-4 py-2">A few minutes (min 60 s)</td>
                <td className="border border-border px-4 py-2"><code>maxDuration</code> + 60 s</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Pro, <code>* * * * *</code></td>
                <td className="border border-border px-4 py-2" colSpan={4}>Not supported one-to-one (TT minimum is 5 min between occurrences)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Store the check-in URL as a production-only secret</h3>
        <p>In your Vercel project, go to <strong>Settings → Environment Variables</strong> and add:</p>
        <ul>
          <li><strong>Key:</strong> <code>TT_CHECKIN_URL</code> (never prefix with <code>NEXT_PUBLIC_</code>).</li>
          <li><strong>Value:</strong> the secret URL you copied from the monitor.</li>
          <li><strong>Environment:</strong> Production only.</li>
        </ul>
        <p>Redeploy your production deployment after adding the variable.</p>

        <h3>Initialize the SDK lazily</h3>
        <p>A module-level <code>init()</code> also runs during <code>next build</code>, when Next.js imports route modules to collect page data. Initialize inside handlers instead:</p>
        <CodeBlock code={`import { init } from "@telemetry-tracker/node";

let ready = false;

// Call this inside handlers, not at module top level: \`next build\` imports route
// modules while collecting page data, and a top-level init() would run there too.
export function ensureTelemetry() {
  if (ready) return;
  init({
    ingestUrl: process.env.TELEMETRY_INGEST_URL ?? "https://api.telemetry-tracker.com",
    apiKey: process.env.TELEMETRY_API_KEY,
    app: "my-app-crons",
    environment: process.env.VERCEL_ENV ?? "development",
    exitOnUnhandledRejection: false, // don't exit a shared serverless instance
  });
  ready = true;
}`} lang="ts" caption="lib/telemetry-server.ts" />

        <h3>The route handler</h3>
        <p>Wrap your job logic in <code>withCheckIn</code>, which sends <code>/start</code> then success or <code>/fail</code>, and reports thrown errors with the monitor name and run id. Call <code>flush()</code> in a <code>finally</code> block so the queued error is sent before the function freezes:</p>
        <CodeBlock code={`import { withCheckIn, flush } from "@telemetry-tracker/node";
import { ensureTelemetry } from "@/lib/telemetry-server";
import { syncInvoices } from "@/lib/invoices";

export const dynamic = "force-dynamic"; // never serve a cached response
export const maxDuration = 60;

export async function GET(request: Request) {
  // 1. Auth first: a stray request never sends a check-in.
  if (request.headers.get("authorization") !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return new Response("Unauthorized", { status: 401 });
  }
  ensureTelemetry();
  try {
    // 2. /start → your job → success, or /fail + error report with monitor context.
    const result = await withCheckIn(
      process.env.TT_CHECKIN_URL!, // unset locally: the job runs, no pings are sent
      () => syncInvoices(),       // must throw on failure (see example below)
      { monitorName: "sync-invoices" },
    );
    return Response.json({ ok: true, result });
  } catch {
    return new Response("Job failed", { status: 500 }); // Vercel marks the run as an error
  } finally {
    // 3. Send the queued error before the function freezes.
    await flush();
  }
}`} lang="ts" caption="app/api/cron/sync-invoices/route.ts" />

        <h3>Arm the monitor</h3>
        <p>New monitors arm on the first signal. After deploying, press <strong>Run</strong> in Vercel → Settings → Cron Jobs once. You should see a start + success pair in the check-in history.</p>

        <h2>Make failures actually fail</h2>
        <p>A common trap: handlers catch their own errors and return 200 or 500 without rethrowing. The check-in sees no exception and marks the run &quot;ok&quot;. Make sure your job function throws on failure:</p>
        <CodeBlock code={`// Before: returns normally, so the check-in says "ok".
// const res = await fetch(url); if (!res.ok) return { error: res.status };

// After: a failed result becomes an exception, so the run is a /fail with an error.
async function syncInvoices() {
  const res = await fetch("https://api.example.com/invoices", { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(\`Invoice API returned \${res.status}\`);
  // ... do the work; throw on anything that means "this run didn't do its job"
}`} lang="ts" caption="Status-aware job that throws on failure" />

        <h2>Catch timeouts with max runtime</h2>
        <p>When Vercel kills a function at <code>maxDuration</code>, no catch block runs and no <code>/fail</code> is sent. The <code>/start</code> signal without a finish times out after the monitor&apos;s max runtime. Set max runtime a little above <code>maxDuration</code> (e.g. <code>maxDuration</code> + 60 seconds). Timeouts alert after max runtime plus up to one evaluator period (about 5 minutes); no error report is created because the function was killed before it could send one.</p>

        <h2>Hobby vs Pro settings</h2>
        <p>Hobby daily crons fire anywhere in the scheduled hour (±59 minutes). Set grace to at least 60 minutes plus worst-case runtime. For example, a daily job with <code>maxDuration: 60</code> needs grace of at least 70 minutes.</p>
        <p>Pro crons have per-minute precision, but Telemetry Tracker requires occurrences at least 5 minutes apart. A cron that runs every 1–4 minutes cannot be monitored one-to-one. Detection can take up to one evaluator period (about 5 minutes) after the deadline.</p>

        <h2>Several schedules on one path</h2>
        <p>You can route multiple <code>vercel.json</code> entries to the same path and pick the check-in URL via the <code>x-vercel-cron-schedule</code> header:</p>
        <CodeBlock code={`// vercel.json
{
  "crons": [
    { "path": "/api/cron/reminders", "schedule": "0 18 * * *" },
    { "path": "/api/cron/reminders", "schedule": "0 19 * * *" }
  ]
}`} lang="json" caption="Two schedules on one route" />
        <CodeBlock code={`const CHECKIN_URLS: Record<string, string | undefined> = {
  "0 18 * * *": process.env.TT_CHECKIN_URL_REMINDERS_18,
  "0 19 * * *": process.env.TT_CHECKIN_URL_REMINDERS_19,
};
const url = CHECKIN_URLS[request.headers.get("x-vercel-cron-schedule") ?? ""];
if (!url) return new Response("No monitor for this schedule", { status: 400 });

await withCheckIn(url, () => sendReminders(), { monitorName: "reminders" });`} lang="ts" caption="Pick the check-in URL from the schedule header" />
        <p>Create one TT monitor per schedule, each with its own secret URL and environment variable.</p>

        <h2>Local runs and preview deployments</h2>
        <p>Vercel crons only run on production deployments. Leave <code>TT_CHECKIN_URL</code> unset in development and preview environments. When the URL is not set, <code>withCheckIn</code> just runs the job without sending pings.</p>
        <p>Set <code>environment</code> on <code>init()</code> so local errors are filterable. Use <code>process.env.VERCEL_ENV ?? &quot;development&quot;</code> to tag production, preview and development correctly.</p>

        <h2>What you see when a run fails</h2>
        <p>When a cron job fails, you receive an alert email within seconds. When it times out, the alert arrives after max runtime plus up to one evaluator period (about 5 minutes). Recovery alerts are sent when the job succeeds again.</p>
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/vercel-cron-email-down-failure.png" width={900} height={340} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Alert email showing sync-invoices monitor is down with the reason Job reported failure" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Down alert for an explicit failure. Screenshot from a test project, not customer data.</figcaption></figure>
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/vercel-cron-email-down-timeout.png" width={900} height={340} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Alert email showing sync-invoices monitor is down with the reason Job exceeded its maximum runtime" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Down alert for a timeout. Screenshot from a test project, not customer data.</figcaption></figure>
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/vercel-cron-email-recovered.png" width={900} height={340} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Alert email showing sync-invoices monitor has recovered with the reason Job reported success" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Recovery alert. Screenshot from a test project, not customer data.</figcaption></figure>
        <p>The check-in history shows each run&apos;s status:</p>
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/vercel-cron-checkins-history.png" width={2560} height={1720} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Check-ins page showing sync-invoices monitor with a history of OK, TIMEOUT, START, OK, FAIL, START, OK check-ins" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Check-in history for a test monitor. Screenshot from a test project, not customer data.</figcaption></figure>
        <p>When a run fails with a thrown error, the error is reported to <strong>Issues</strong> under its message. The occurrence shows a Context block with <code>checkin</code> and <code>checkin_run_id</code>:</p>
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/vercel-cron-error-issue-context.png" width={2560} height={2636} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Error issue page showing Invoice API returned 401 error with context checkin sync-invoices and checkin_run_id" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Error issue with check-in context. Server stack frames may point at compiled .next/server chunks; the message and context are reliable. Screenshot from a test project, not customer data.</figcaption></figure>
        <p>Note that server stack frames may point at compiled <code>.next/server</code> chunks rather than source files. The error message and the context (monitor name and run id) are the reliable parts. Timeouts produce no error report because the function is killed before it can send one.</p>

        <h2>Telemetry Tracker vs Sentry Crons vs a heartbeat service</h2>
        <p>This is our product, and the comparison is ours.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-border">
            <thead>
              <tr className="bg-muted">
                <th className="border border-border px-4 py-2 text-left">Feature</th>
                <th className="border border-border px-4 py-2 text-left">Sentry Crons</th>
                <th className="border border-border px-4 py-2 text-left">Telemetry Tracker</th>
                <th className="border border-border px-4 py-2 text-left">Heartbeat service</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-4 py-2">Monitors on free plan</td>
                <td className="border border-border px-4 py-2">1 (extra monitors need a paid plan)</td>
                <td className="border border-border px-4 py-2">5 per project</td>
                <td className="border border-border px-4 py-2">Check their pricing</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Errors in the same tool</td>
                <td className="border border-border px-4 py-2">Yes</td>
                <td className="border border-border px-4 py-2">Yes</td>
                <td className="border border-border px-4 py-2">No</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Monitors from code / auto vercel.json</td>
                <td className="border border-border px-4 py-2">Yes</td>
                <td className="border border-border px-4 py-2">No (dashboard only)</td>
                <td className="border border-border px-4 py-2">Varies</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Recovery alert</td>
                <td className="border border-border px-4 py-2">Yes</td>
                <td className="border border-border px-4 py-2">Yes</td>
                <td className="border border-border px-4 py-2">Varies</td>
              </tr>
              <tr>
                <td className="border border-border px-4 py-2">Self-hostable</td>
                <td className="border border-border px-4 py-2">Yes (self-hosted Sentry)</td>
                <td className="border border-border px-4 py-2">Yes (MIT)</td>
                <td className="border border-border px-4 py-2">Varies</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>See the <Link href="/sentry-alternative" className="text-brand hover:underline">Sentry alternative page</Link> and <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">migration guide</Link> for more details on Telemetry Tracker vs Sentry.</p>

        <h2>Frequently asked questions</h2>
        {FAQ.map(({ question, answer }) => <section key={question}><h3>{question}</h3><p>{answer}</p></section>)}
        <GuideCta heading="Start monitoring your Vercel cron jobs for free" body="Create a free Telemetry Tracker project, add one check-in per cron, and the next missed or failed run will alert you. The error that caused it is in the same project, tagged with the run." secondaryHref="/docs/checkins" secondaryLabel="Check-ins reference" />
      </MarketingGuideLayout>
    </>
  );
}
