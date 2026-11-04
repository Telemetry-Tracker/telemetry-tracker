import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  howToJsonLd,
  marketingGuideMetadata,
  webPageJsonLd,
} from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";
import { nodeExpressErrorHandler, nodeInstall, nodeMiddleware, nodeSetup, nodeTestError } from "@/lib/sdk-setup-snippets";
import { HOSTED_API_URL } from "@/lib/hosted-cloud";

const PATH = "/error-tracking/nodejs";
const TITLE = "Node.js Error Tracking: Crashes, Express and Cron Jobs";
const DESCRIPTION =
  "Track Node.js errors: uncaught exceptions and unhandled rejections are reported automatically, plus Express route errors, handled errors and cron jobs. Free plan.";

const nodeContextSetup = `import { init, identify, trackError } from "@telemetry-tracker/node";

init({
  ingestUrl: process.env.TELEMETRY_INGEST_URL || "${HOSTED_API_URL}",
  app: "my-api",
  apiKey: process.env.TELEMETRY_API_KEY,
  environment: process.env.NODE_ENV,           // e.g. "production"
  release: process.env.GIT_SHA,                // attached to every error and event
  piiScrub: { denyKeys: ["password", "token"] }, // optional client-side redaction
});

// Per request, once you know who the user is:
identify(user.id);

try {
  await chargeCard(order);
} catch (err) {
  trackError(err, { orderId: order.id, step: "charge" });
  throw err; // or handle it
}`;

const nodeCronCheckIn = `import { init, withCheckIn } from "@telemetry-tracker/node";

init({ ingestUrl: process.env.TELEMETRY_INGEST_URL!, app: "worker", apiKey: process.env.TELEMETRY_API_KEY });

await withCheckIn(process.env.TT_CHECKIN_URL!, () => runNightlyBackup(), {
  monitorName: "Nightly backup",
});`;

const nodeScriptFlush = `import { init, trackEvent, flush } from "@telemetry-tracker/node";

init({ ingestUrl: process.env.TELEMETRY_INGEST_URL!, app: "report-cli", apiKey: process.env.TELEMETRY_API_KEY });

await generateReport();
trackEvent("daily_report_finished");
await flush(); // send batched events before the script ends (>= 1.4.2)`;

const FAQ = [
  {
    question: "Does Telemetry Tracker catch uncaught exceptions in Node.js automatically?",
    answer:
      "Yes. init() registers process handlers for uncaughtException and unhandledRejection. The error is reported, the SDK waits up to fatalFlushTimeoutMs (default 2000 ms) for the ingest request, then exits with code 1, as Node does without the SDK.",
  },
  {
    question: "Why are errors from my Express routes not reported?",
    answer:
      "Express catches errors thrown in route handlers and returns a 500 itself, so they never reach the process handlers. Add an error-handling middleware with four arguments after your routes and call trackError(err) there.",
  },
  {
    question: "Can I keep the process running after an unhandled promise rejection?",
    answer:
      "Yes. Set exitOnUnhandledRejection: false in init(). The rejection is still reported with source unhandledRejection, but the process keeps running. Uncaught exceptions always exit with code 1.",
  },
  {
    question: "Does @telemetry-tracker/node work with CommonJS require()?",
    answer:
      "Not directly. The package is ES modules only. From CommonJS code, load it with a dynamic import() and await it before calling init().",
  },
  {
    question: "Does it work with NestJS and Fastify?",
    answer:
      "NestJS uses the same package; call init() in main.ts as shown in the NestJS docs. The request middleware has a generic (req, res, next) signature, so Express and Connect-style apps can use it directly; other frameworks may need a thin wrapper.",
  },
] as const;

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    omitBrandSuffix: true,
  });
}

export default function NodeJsErrorTrackingPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
          faqPageJsonLd(FAQ),
          webPageJsonLd({ origin, path: PATH, name: TITLE, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "Node.js error tracking", path: PATH },
          ]),
          howToJsonLd({
            name: "Set up Node.js error tracking with Telemetry Tracker",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Create a free account",
                text: "Register, create a project, and store the API key as TELEMETRY_API_KEY. No credit card is required.",
              },
              {
                name: "Install the Node SDK",
                text: "Add @telemetry-tracker/node to your server.",
              },
              {
                name: "Call init as early as possible",
                text: "Pass ingest URL, app name, and API key at the top of the entry file.",
              },
              {
                name: "Send a test error",
                text: "Call trackError or trigger an unhandled rejection, then open Issues.",
              },
              {
                name: "Report Express route errors",
                text: "Add an error-handling middleware after your routes that calls trackError(err).",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title="Node.js error tracking"
        updated="2026-11"
        lede={
          <p>
            <code>@telemetry-tracker/node</code> wraps core for servers. After <code>init()</code>,
            it installs handlers for <code>uncaughtException</code> and{" "}
            <code>unhandledRejection</code>, flushes the error to ingest, then exits with code 1
            (Node’s default). Set <code>exitOnUnhandledRejection: false</code> to only report
            rejections and keep the process running. Optional request middleware sends a{" "}
            <code>$request</code> event per HTTP call with <code>duration_ms</code> until the
            response finishes.
          </p>
        }
      >
        <p>
          NestJS uses the same package — see the{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS guide
          </Link>
          . Browser and Next.js apps should use core or{" "}
          <code>@telemetry-tracker/next</code>, not this package.
        </p>

        <h2>Which Node.js errors are captured</h2>
        <p>
          A Node.js process fails in several different ways, and not all of them reach the same
          place. This is what <code>@telemetry-tracker/node</code> covers and what you add:
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-border bg-surface/70 text-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Failure</th>
              <th className="px-4 py-3 font-medium">How it is reported</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border last:border-0">
              <td className="px-4 py-3 align-top">Uncaught exception (a throw nobody catches)</td>
              <td className="px-4 py-3 align-top">Automatic after <code>init()</code>; flush, then exit code 1</td>
            </tr>
            <tr className="border-b border-border last:border-0">
              <td className="px-4 py-3 align-top">Unhandled promise rejection</td>
              <td className="px-4 py-3 align-top">
                Automatic; exits with code 1 by default, or keeps running with{" "}
                <code>exitOnUnhandledRejection: false</code>
              </td>
            </tr>
            <tr className="border-b border-border last:border-0">
              <td className="px-4 py-3 align-top">Error inside an Express route</td>
              <td className="px-4 py-3 align-top">
                Express catches it, so add an{" "}
                <a href="#express-error-handler" className="text-brand hover:underline">
                  error-handling middleware
                </a>{" "}
                that calls <code>trackError</code>
              </td>
            </tr>
            <tr className="border-b border-border last:border-0">
              <td className="px-4 py-3 align-top">Error you catch and handle yourself</td>
              <td className="px-4 py-3 align-top">
                <code>trackError(err, context)</code> in the <code>catch</code> block
              </td>
            </tr>
            <tr className="border-b border-border last:border-0">
              <td className="px-4 py-3 align-top">Failed or missed cron / background job</td>
              <td className="px-4 py-3 align-top">
                <a href="#cron-jobs" className="text-brand hover:underline">
                  <code>withCheckIn()</code>
                </a>{" "}
                sends start, success and fail signals and reports the thrown error
              </td>
            </tr>
          </tbody>
        </table>
        </div>

        <h2>What the integration does</h2>
        <ul>
          <li>
            <code>init()</code> as early as possible in the entry file.
          </li>
          <li>
            Global handlers for uncaught exceptions and unhandled promise rejections.
          </li>
          <li>
            <code>trackError</code> / <code>trackEvent</code> for handled failures and server events.
          </li>
          <li>
            Optional <code>middleware()</code> for method, URL, and duration (
            <code>$request</code>).
          </li>
        </ul>

        <h2>Install</h2>
        <CodeBlock code={nodeInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>Call init at the top of your entry file. Keep the API key in an environment variable:</p>
        <CodeBlock code={nodeSetup} lang="typescript" caption="init" />
        <p>
          <code>ingestUrl</code> is required: the SDK has no built-in default. The fallback above is
          the hosted API (<code>{HOSTED_API_URL}</code>); point <code>TELEMETRY_INGEST_URL</code> at
          your own API when self-hosting. The package is ES modules only; see the{" "}
          <Link href="/docs/node" className="text-brand hover:underline">Node.js docs</Link> for use from CommonJS.
        </p>

        <h2>Send a test error</h2>
        <CodeBlock code={nodeTestError} lang="typescript" caption="Test error" />
        <p>
          You can also throw an unhandled rejection once to confirm the global handler. Then open
          Issues in the dashboard.
        </p>

        <h2>Optional request middleware</h2>
        <p>
          Attach this to Express, Fastify, or similar so each request emits method, url, and{" "}
          <code>duration_ms</code>. Leave <code>trackRequestBody</code> false unless you have a reason
          to include bodies (PII and size).
        </p>
        <CodeBlock code={nodeMiddleware} lang="typescript" caption="middleware" />

        <h2 id="express-error-handler">Express error handler</h2>
        <p>
          Errors Express catches in a route do not reach the global handlers. Report them from an
          error-handling middleware registered after your routes:
        </p>
        <CodeBlock code={nodeExpressErrorHandler} lang="typescript" caption="Express error handler" />

        <h2>How crash reporting works</h2>
        <p>
          On <code>uncaughtException</code> the SDK reports the error with{" "}
          <code>{`{ source: "uncaughtException" }`}</code>, waits for the ingest request for up to{" "}
          <code>fatalFlushTimeoutMs</code> (default 2000 ms), then calls{" "}
          <code>process.exit(1)</code>. The timer is cleared as soon as the request settles, so a
          fast network means a fast exit. Unhandled rejections behave the same way by default,
          matching Node’s own behaviour since v15.
        </p>
        <ul>
          <li>
            Thrown values that are not <code>Error</code> objects (strings, <code>null</code>,
            plain objects) are normalized before they are sent.
          </li>
          <li>
            With <code>node --unhandled-rejections=strict</code>, a rejection is also raised as an
            uncaught exception; the SDK reports it once and exits once.
          </li>
          <li>
            Telemetry failures inside the crash handler are swallowed, so the SDK does not change
            your exit code.
          </li>
        </ul>
        <p>
          Your process manager (systemd, PM2, Docker, Kubernetes) should still restart the process
          after the exit. The SDK reports the crash; it does not keep a broken process alive.
        </p>

        <h2>Add context: environment, release and user</h2>
        <p>
          <code>environment</code> and <code>release</code> from <code>init()</code> are attached to
          every error and event, so you can tell a staging error from production and see which
          deploy introduced it. <code>identify()</code> sets the user id for later reports, and the
          second argument of <code>trackError</code> is free-form context:
        </p>
        <CodeBlock code={nodeContextSetup} lang="typescript" caption="Context and handled errors" />
        <p>
          <code>piiScrub</code> is off by default and redacts matching keys and text in the SDK
          before sending. It complements server-side scrubbing at ingest; do not rely on it alone.
          Bundling your server? Upload{" "}
          <Link href="/docs/source-maps" className="text-brand hover:underline">
            source maps
          </Link>{" "}
          to see original stack frames.
        </p>

        <h2 id="cron-jobs">Cron jobs and background workers</h2>
        <p>
          A job that silently stops running produces no error at all. <code>withCheckIn()</code>{" "}
          wraps the job, sends start, success and fail signals to a check-in monitor, and reports
          the thrown error with the monitor name. A check-in network failure never fails your job,
          and the job’s own error is rethrown unchanged.
        </p>
        <CodeBlock code={nodeCronCheckIn} lang="typescript" caption="withCheckIn" />
        <p>
          Create the monitor and its URL in the dashboard; keep the URL in a secret. Schedules,
          grace periods and alerts are described in the{" "}
          <Link href="/docs/checkins" className="text-brand hover:underline">
            check-in docs
          </Link>
          , and notification channels in{" "}
          <Link href="/docs/alerts" className="text-brand hover:underline">
            Alerts
          </Link>
          .
        </p>

        <h2>Short-lived scripts and CLIs</h2>
        <p>
          Events from <code>trackEvent</code> are batched (every 5 seconds or 10 events by
          default). In a script that ends quickly, call <code>await flush()</code> before it
          finishes. The SDK also flushes on <code>beforeExit</code>, but nothing can be sent after an
          explicit <code>process.exit()</code>.
        </p>
        <CodeBlock code={nodeScriptFlush} lang="typescript" caption="flush" />

        <h2>Limits to know</h2>
        <ul>
          <li>
            ES modules only: use a dynamic <code>import()</code> from CommonJS.
          </li>
          <li>
            The request middleware records method, URL and <code>duration_ms</code>; it is not
            distributed tracing.
          </li>
          <li>
            Web Vitals are browser-only (see below). Next.js server code should use{" "}
            <Link href="/error-tracking/nextjs" className="text-brand hover:underline">
              @telemetry-tracker/next
            </Link>
            .
          </li>
        </ul>

        <h2>What you will see</h2>
        <p>
          Server errors group like browser issues: fingerprint, stack, and the context object you
          passed. Filter by <code>app</code> (here <code>my-api</code>) and <code>platform</code>{" "}
          <code>node</code>. Request events appear in Events if you enabled middleware.
        </p>
        <p>
          Free hosted plan: €0, no credit card, 250K ingest units per month, 14-day retention.{" "}
          <Link href="/pricing" className="text-brand hover:underline">
            Pricing
          </Link>
          .
        </p>

        <h2>FAQ</h2>
        {FAQ.map((item) => (
          <div key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </div>
        ))}

        <h2>Full documentation</h2>
        <p>
          <Link href="/docs/node" className="text-brand hover:underline">
            Node.js SDK docs
          </Link>
          . NestJS bootstrap:{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS
          </Link>
          . Account setup:{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud
          </Link>
          .
        </p>

        <h2>Browser Web Vitals</h2>
        <p>
          LCP, INP, CLS and TTFB are browser measurements and are not collected from Node.js
          apps. If your project also has a web frontend, the browser SDK collects them by default
          in the same dashboard. See the{" "}
          <Link href="/docs/sdk#sdk-web-vitals-heading" className="text-brand hover:underline">
            Web Vitals configuration
          </Link>
          .
        </p>

        <GuideCta />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/nextjs",
              label: "Next.js error tracking",
              description: "Browser and App Router errors in the same project.",
            },
            {
              href: "/docs/node",
              label: "Node.js docs",
              description: "Handlers, middleware, and NestJS pointer.",
            },
            {
              href: "/docs/nestjs",
              label: "NestJS docs",
              description: "init in main.ts plus the same node package.",
            },
            {
              href: "/docs/checkins",
              label: "Cron check-ins",
              description: "Monitors for scheduled jobs, with withCheckIn for Node.",
            },
            {
              href: "/sentry-alternative",
              label: "Sentry alternative",
              description: "How Telemetry Tracker compares with Sentry.",
            },
            {
              href: "/self-hosted-error-tracking",
              label: "Self-hosted error tracking",
              description: "Point TELEMETRY_INGEST_URL at your own API.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
