import Image from "next/image";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import { breadcrumbJsonLd, marketingGuideMetadata, webPageJsonLd } from "@/lib/marketing-guide-metadata";
import { nextEnvLocalServer, nextInstall, nextInstrumentation, nextErrorBoundary } from "@/lib/sdk-setup-snippets";

const PATH = "/monitoring/nextjs";
const ORIGIN = "https://telemetry-tracker.com";
const TITLE = "Next.js Monitoring: Errors, Web Vitals & Releases";
const DESCRIPTION = "Monitor Next.js browser and App Router errors, Core Web Vitals, custom events and release health. Explore the free cloud plan or self-host Telemetry Tracker.";
const FAQ = [
  { question: "Does this capture Next.js server errors?", answer: "Yes. On Next.js 15+, createOnRequestError captures uncaught App Router errors from Server Components, Route Handlers and Server Actions on Node and Edge. Caught errors and build failures are not reported." },
  { question: "Are Web Vitals enabled by default?", answer: "Yes. The browser SDK collects LCP, INP, CLS and TTFB by default; set webVitals: false to opt out. Performance also supports legacy FID data, but the current SDK does not automatically collect FID." },
  { question: "Is this session replay or full APM?", answer: "No. Sessions are telemetry timelines, not replay. Telemetry Tracker does not provide distributed tracing, log collection or profiling. These integrations support JavaScript and TypeScript." },
  { question: "Can I use it without paying for cloud hosting?", answer: "The free cloud plan is €0, with 250K ingest units per month, 14-day retention and one project. No credit card is required. You can also self-host the MIT-licensed API and dashboard." },
];

export function generateMetadata() {
  const metadata = marketingGuideMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });
  return {
    ...metadata,
    alternates: { canonical: `${ORIGIN}${PATH}` },
    openGraph: { ...metadata.openGraph, url: `${ORIGIN}${PATH}` },
  };
}

export default function NextJsMonitoringPage() {
  return (
    <>
      <GuideJsonLd data={[
        webPageJsonLd({ origin: ORIGIN, path: PATH, name: TITLE, description: DESCRIPTION }),
        breadcrumbJsonLd(ORIGIN, [{ name: "Home", path: "" }, { name: "Next.js monitoring", path: PATH }]),
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
      ]} />
      <MarketingGuideLayout kicker="Next.js monitoring" title="Monitor a Next.js app: errors, Web Vitals and releases in one place" lede={<p>Connect browser errors, App Router server errors, real-user Web Vitals and release health with Telemetry Tracker. Use hosted cloud or your own API and dashboard.</p>} updated="2026-10">
        <h2>Client errors and page changes</h2>
        <p><code>TelemetryProvider</code> initializes the browser SDK, which captures uncaught errors and unhandled promise rejections. <code>TelemetryErrorBoundary</code> reports React render errors. <code>useTrackPage(pathname)</code> sends screen events as routes change.</p>
        <CodeBlock code={nextInstall} lang="bash" caption="Install the Next.js SDK" />
        <p>Follow the <Link href="/docs/nextjs" className="text-brand hover:underline">Next.js setup guide</Link> for the server root layout, client page tracker and <code>NEXT_PUBLIC_TELEMETRY_INGEST_URL</code>, <code>NEXT_PUBLIC_TELEMETRY_API_KEY</code> and <code>NEXT_PUBLIC_TELEMETRY_APP</code> variables. For a focused error setup, see <Link href="/error-tracking/nextjs" className="text-brand hover:underline">Next.js error tracking</Link>.</p>
        <CodeBlock code={nextErrorBoundary} lang="tsx" caption="Wrap your client component in an error boundary" />

        <h2>App Router server errors on Node and Edge</h2>
        <p>On Next.js 15+, export <code>createOnRequestError</code> from <code>instrumentation.ts</code> to capture uncaught errors that Next.js reports from Server Components (RSC), Route Handlers and Server Actions. The hook runs on both Node and Edge. The browser integration also supports Next.js 14, but this server hook does not.</p>
        <CodeBlock code={nextEnvLocalServer} lang="bash" caption="Server-only environment variables" />
        <CodeBlock code={nextInstrumentation} lang="ts" caption="instrumentation.ts" />
        <p>Use the server-only <code>TELEMETRY_API_KEY</code> for this hook. It does not report errors you catch without rethrowing, build or compile failures, or background work that never surfaces as a request error.</p>

        <h2>Core Web Vitals from real users</h2>
        <p>The browser SDK collects LCP (loading), INP (interaction responsiveness), CLS (layout stability) and TTFB (time to first byte) by default. Set <code>webVitals: false</code> in the provider config to opt out. Performance also supports legacy FID (first input delay) data; the current SDK does not automatically collect FID.</p>
        <p>Open <strong>Performance</strong> for metric summaries, good / needs-improvement / poor distributions, trends and slow pages. These are browser field measurements, not lab tests or traces of database calls.</p>
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/monitoring-nextjs-performance.png" width={2400} height={1200} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Telemetry Tracker Performance page showing LCP, INP, CLS and TTFB p75 values, average response time, Apdex and a Good / Needs improvement / Poor rating distribution" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Performance page from a local test project. The data was sent with the Telemetry Tracker SDKs; it is not customer data.</figcaption></figure>

        <h2>Node request latency: where the middleware fits</h2>
        <p>The <code>@telemetry-tracker/node</code> request middleware emits <code>$request</code> events with <code>method</code>, <code>url</code> and <code>duration_ms</code> when the Node response finishes or closes. Performance summarizes p50 and p95 latency per route.</p>
        <p>This fits an Express-style custom Node server around Next.js, or a separate Node API, after initializing the Node SDK. It is not an automatic App Router Route Handler integration: Route Handlers use Web Request/Response objects rather than the Node response emitter this middleware times. The server error hook above does not collect request latency.</p>
        <p><strong>Route error-rate caveat:</strong> the middleware does not automatically record the HTTP status code. Route error rate stays empty unless you send <code>status_code</code> with your request events. Latency measurement alone does not establish a request&apos;s success or failure.</p>

        <h2>Custom events and session timelines</h2>
        <p>Send meaningful actions with <code>trackEvent</code> from client code after the provider initializes. Sessions connect events, screens and errors in a telemetry timeline. They do not record video or replay the browser.</p>
        <CodeBlock code={'"use client";\n\nimport { trackEvent } from "@telemetry-tracker/next";\n\nexport function ExportButton() {\n  return (\n    <button onClick={() => trackEvent("export_clicked", { format: "csv" })}>\n      Export\n    </button>\n  );\n}'} lang="tsx" caption="A custom event from a client button" />

        <h2>Release health after each deploy</h2>
        <p>Pass a <code>release</code> tag in the provider config and the server hook config, using the same version for a deployment. Set it before telemetry initializes. The <strong>Releases</strong> page shows sessions, active users, events, errors, error rate, adoption share and deltas versus the previous release. These summaries depend on tagged telemetry; there are no suspect-commit or deploy-marker integrations.</p>
        <CodeBlock code={'// Add to both TelemetryProvider config and createOnRequestError config:\nrelease: "2026.10.11",'} lang="ts" caption="Use the same release tag on browser and server telemetry" />
        <figure className="overflow-hidden rounded-lg border border-border"><Image src="/marketing/monitoring-nextjs-releases.png" width={2400} height={900} sizes="(max-width: 768px) 100vw, 768px" className="h-auto w-full" alt="Telemetry Tracker Releases page comparing release 1.5.0 with 1.4.0 by sessions, users, events, errors, error rate and adoption" /><figcaption className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Releases page from a local test project with two releases. The data was sent with the Telemetry Tracker SDKs; it is not customer data.</figcaption></figure>

        <h2>Alerts with explicit editor limits</h2>
        <p>Alert channels include in-app notifications, email, generic webhooks, Slack, Discord, Telegram and Microsoft Teams. Built-in error-spike and quota rules are available.</p>
        <p>The dashboard rule editor authors <code>ERROR_COUNT</code> and <code>NO_EVENTS</code> (business heartbeat) conditions. <code>ERROR_RATE</code>, <code>SESSION_DROP</code>, <code>NEW_ERROR_GROUP</code>, <code>AFFECTED_USERS</code>, <code>QUOTA_PERCENT</code> and <code>HEARTBEAT</code> are API-only conditions. Self-hosted scheduled conditions require the alert-rules evaluator cron. See <Link href="/docs/alerts" className="text-brand hover:underline">alert setup and delivery documentation</Link>.</p>

        <h2>Source maps for readable errors</h2>
        <p>Upload source maps for the same app and release as your telemetry to symbolicate minified stack frames. The Vite plugin is available for Vite builds; it is not a Next.js build plugin. For Next.js, follow the upload workflow in the <Link href="/docs/source-maps" className="text-brand hover:underline">source-map documentation</Link>.</p>

        <h2>Free cloud plan or self-hosting</h2>
        <p>The free hosted plan is €0 with no credit card: 250K ingest units per month, 14-day retention, one project and two API keys. An ingest unit is one accepted event, one batch item, one error or one session. At the monthly cap, ingest returns HTTP 429; stored data remains and there is no overage bill. See <Link href="/pricing" className="text-brand hover:underline">pricing and plan limits</Link>.</p>
        <p>You can self-host the MIT-licensed Fastify API, Next.js dashboard and PostgreSQL database. You operate the deployment, retention jobs and alert workers yourself; see <Link href="/docs/self-hosting" className="text-brand hover:underline">self-hosting documentation</Link>.</p>

        <h2>Vercel cron jobs</h2>
        <p>See our <Link href="/monitoring/nextjs/vercel-cron-jobs" className="text-brand hover:underline">full Vercel cron jobs guide</Link> for monitoring cron failures, timeouts and missed runs with check-ins and error tracking.</p>

        <h2>What this monitoring does not include</h2>
        <p>These SDK integrations support JavaScript and TypeScript. Telemetry Tracker does not provide distributed tracing, log collection, session replay or profiling. Request latency is basic timing, not full APM; it does not break down database or external-service calls.</p>

        <h2>Frequently asked questions</h2>
        {FAQ.map(({ question, answer }) => <section key={question}><h3>{question}</h3><p>{answer}</p></section>)}
        <GuideCta heading="Start monitoring your Next.js app for free" body="Create a project, connect the SDK and inspect errors and real-user Web Vitals as telemetry arrives." secondaryHref="/docs/nextjs" secondaryLabel="Next.js setup guide" />
      </MarketingGuideLayout>
    </>
  );
}
