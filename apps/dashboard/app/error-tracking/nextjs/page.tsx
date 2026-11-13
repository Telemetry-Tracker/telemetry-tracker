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
import {
  nextDocsCheckButton,
  nextEnvLocal,
  nextEnvLocalServer,
  nextErrorBoundary,
  nextInstall,
  nextInstrumentation,
  nextProviderSetup,
  nextTestError,
  nextTrackPageView,
} from "@/lib/sdk-setup-snippets";

const PATH = "/error-tracking/nextjs";
const TITLE = "Next.js Error Tracking: App Router, error.tsx and Server Errors";
const DESCRIPTION =
  "Next.js error tracking for the App Router: init in instrumentation-client.ts, report errors caught by error.tsx and global-error.tsx, and capture server errors with onRequestError.";

const INSTRUMENTATION_CLIENT_SNIPPET = `// instrumentation-client.ts (project root or src/, Next.js 15.3+)
// Runs before hydration, so the SDK is ready for errors on the first render
// and keeps running when an error screen replaces the root layout.
import { init } from "@telemetry-tracker/next";

init({
  ingestUrl:
    process.env.NEXT_PUBLIC_TELEMETRY_INGEST_URL ?? "https://api.telemetry-tracker.com",
  app: process.env.NEXT_PUBLIC_TELEMETRY_APP ?? "my-next-app",
  apiKey: process.env.NEXT_PUBLIC_TELEMETRY_API_KEY,
  // Must match the release used for the source-map upload (e.g. the commit SHA).
  release: process.env.NEXT_PUBLIC_TELEMETRY_RELEASE,
});`;

const LAYOUT_NO_PROVIDER_SNIPPET = `// app/layout.tsx — no provider needed when init() runs in instrumentation-client.ts
import { TrackPageView } from "./track-page-view";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TrackPageView />
        {children}
      </body>
    </html>
  );
}`;

const ERROR_TSX_SNIPPET = `// app/error.tsx (or any route segment's error.tsx)
"use client";

import { useEffect } from "react";
import { trackError, trackEvent } from "@telemetry-tracker/next";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (error.digest) {
      // Server error: onRequestError (instrumentation.ts) already sent the real
      // message and stack. Record that a user saw it.
      trackEvent("server_error_shown", { digest: error.digest, path: window.location.pathname });
    } else {
      // Browser render error: Next.js only logs it to the console in production.
      trackError(error, { boundary: "app/error.tsx" });
    }
  }, [error]);

  return (
    <div>
      <h2>Something went wrong.</h2>
      {error.digest && <p>Reference: {error.digest}</p>}
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}`;

const GLOBAL_ERROR_SNIPPET = `// app/global-error.tsx — replaces the root layout, so it renders <html> and <body>
"use client";

import { useEffect } from "react";
import { trackError, trackEvent } from "@telemetry-tracker/next";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (error.digest) {
      trackEvent("server_error_shown", { digest: error.digest, path: window.location.pathname });
    } else {
      trackError(error, { boundary: "app/global-error.tsx" });
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h2>Something went wrong.</h2>
        {error.digest && <p>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}`;

const FAQ = [
  {
    question: "Does Telemetry Tracker catch Next.js render errors automatically?",
    answer:
      "Only the ones no error file of yours catches. Next.js passes those to the browser's reportError, and the SDK's window.onerror handler reports them as long as the SDK is still running, which is why init() belongs in instrumentation-client.ts. Errors that your error.tsx or global-error.tsx catches are only logged to the console in production builds, so call trackError there.",
  },
  {
    question: "Why initialize in instrumentation-client.ts instead of TelemetryProvider?",
    answer:
      "instrumentation-client.ts runs before hydration and is not part of the React tree. In @telemetry-tracker/next 1.3.3 TelemetryProvider shuts the SDK down when it unmounts, and it unmounts when global-error.tsx or Next.js's built-in error screen replaces the root layout, so those crashes are dropped. A crash during hydration happens before the provider initializes at all.",
  },
  {
    question: "Will a server error be reported twice, by onRequestError and by error.tsx?",
    answer:
      "Not with the snippets on this page. A server error reaches the browser with a digest and no real message, and onRequestError has already sent the original error. The error.tsx snippet records a server_error_shown event with the digest instead of a second error.",
  },
  {
    question: "Are errors in event handlers and promises reported?",
    answer:
      "Yes, if nothing catches them. Error boundaries, including error.tsx, do not catch errors in onClick handlers, timeouts or promises, so they reach window.onerror or the unhandledrejection handler. If you catch an error yourself, call trackError in the catch block.",
  },
  {
    question: "Does this work on Next.js 14 or 15.0–15.2?",
    answer:
      "The browser SDK does. instrumentation-client.ts needs Next.js 15.3 and onRequestError needs Next.js 15, so on older versions use TelemetryProvider, wrap the app in TelemetryErrorBoundary inside it, and call trackError in your error.tsx files.",
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

export default function NextJsErrorTrackingPage() {
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
            { name: "Next.js error tracking", path: PATH },
          ]),
          howToJsonLd({
            name: "Set up Next.js error tracking with Telemetry Tracker",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Create a free account",
                text: "Register at telemetry-tracker.com, create a project, and copy an API key. No credit card is required.",
              },
              {
                name: "Install the Next.js SDK",
                text: "Add @telemetry-tracker/next to your app.",
              },
              {
                name: "Initialize the SDK in instrumentation-client.ts",
                text: "Set NEXT_PUBLIC_TELEMETRY_INGEST_URL to https://api.telemetry-tracker.com and NEXT_PUBLIC_TELEMETRY_API_KEY from Settings → API keys, call init() in instrumentation-client.ts (Next.js 15.3+), and add the client TrackPageView component to the root layout.",
              },
              {
                name: "Report errors from error.tsx and global-error.tsx",
                text: "Call trackError in a useEffect in each error.tsx and in global-error.tsx. Errors these files catch are only logged to the console in production.",
              },
              {
                name: "Capture server errors",
                text: "Optionally export onRequestError from instrumentation.ts with createOnRequestError (Next.js 15+) for Server Components, Route Handlers and Server Actions.",
              },
              {
                name: "Send a test error",
                text: "Call trackError(new Error(\"docs-check\")) from a client button, then open Issues in the dashboard.",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title="Next.js error tracking"
        lede={
          <p>
            <code>@telemetry-tracker/next</code> wraps the core SDK for App Router apps. Call{" "}
            <code>init()</code> in <code>instrumentation-client.ts</code> and uncaught browser errors
            and unhandled promise rejections are reported from the first render. Errors that your{" "}
            <code>error.tsx</code> or <code>global-error.tsx</code> catches are not uncaught: Next.js
            only logs them to the console in production, so each of those files needs one{" "}
            <code>trackError</code> call. Optionally, <code>createOnRequestError</code> captures
            server-side App Router errors.
          </p>
        }
      >
        <p>
          This is the hosted path: ingest at{" "}
          <code>https://api.telemetry-tracker.com</code>. The{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            full Next.js docs
          </Link>{" "}
          cover the same APIs if you point <code>ingestUrl</code> at a self-hosted API instead.
        </p>

        <h2>What the integration does</h2>
        <ul>
          <li>
            <code>init()</code> starts the SDK once, ideally in <code>instrumentation-client.ts</code>{" "}
            (<code>TelemetryProvider</code> is the fallback for Next.js versions before 15.3).
          </li>
          <li>
            Browser uncaught errors and unhandled rejections are sent automatically.
          </li>
          <li>
            <code>trackError</code> in <code>error.tsx</code> and <code>global-error.tsx</code>{" "}
            reports the render errors those files catch; <code>TelemetryErrorBoundary</code> does the
            same for parts of the tree you wrap yourself.
          </li>
          <li>
            <code>useTrackPage(pathname)</code> sends a screen event on each route change.
          </li>
          <li>
            <code>trackError</code>, <code>trackEvent</code>, <code>screen</code>, and{" "}
            <code>identify</code> are re-exported from the same package.
          </li>
          <li>
            Optional <code>createOnRequestError</code> in <code>instrumentation.ts</code> captures
            uncaught App Router server errors (Next.js 15+), matching{" "}
            <Link href="/docs/nextjs" className="text-brand hover:underline">
              /docs/nextjs
            </Link>
            .
          </li>
        </ul>

        <h2>Real-user Web Vitals in the same SDK</h2>
        <p>
          Browser apps collect LCP, INP, CLS and TTFB by default after SDK initialization, where
          supported by the browser. Next.js uses <code>@telemetry-tracker/next</code>; React uses
          <code>@telemetry-tracker/core</code>. No extra package or separate Web Vitals setup is
          needed. This gives small teams error tracking with Web Vitals from real visits in one
          dashboard.
        </p>
        <p>
          Open <strong>Performance</strong> for p75 values, ratings and trends, plus the Slow pages
          table with LCP and CLS by page path. <strong>Overview</strong> includes a Web Vitals
          snapshot. Set <code>webVitals: false</code> in the <code>init()</code> (or{" "}
          <code>TelemetryProvider</code>) config to turn capture off.
          Each reported metric is an event and counts as one ingest unit toward your plan limit.
          These are browser measurements, not native React Native or Node.js server metrics.
        </p>
        <p>
          See the{" "}
          <Link href="/docs/sdk#sdk-web-vitals-heading" className="text-brand hover:underline">
            Web Vitals configuration and limitations
          </Link>
          . For a broader Next.js monitoring overview covering Web Vitals, releases, alerts and more in one place, see{" "}
          <Link href="/monitoring/nextjs" className="text-brand hover:underline">
            Next.js monitoring
          </Link>
          .
        </p>

        <h2>Install</h2>
        <CodeBlock code={nextInstall} lang="bash" caption="Install" />

        <h2 id="setup">Minimal setup (Next.js 15.3+)</h2>
        <p>
          Initialize the SDK in <code>instrumentation-client.ts</code> at the project root (or in{" "}
          <code>src/</code>). Next.js runs this file after the HTML loads and before React hydrates,
          so the SDK is ready for a crash on the very first render, and it is not part of the React
          tree, so it keeps running when an error screen replaces your root layout. Set the hosted
          ingest URL (<code>https://api.telemetry-tracker.com</code>), app name, and{" "}
          <code>NEXT_PUBLIC_TELEMETRY_API_KEY</code> from <strong>Settings → API keys</strong>.
        </p>
        <CodeBlock code={nextEnvLocal} lang="bash" caption=".env.local (browser)" />
        <CodeBlock code={INSTRUMENTATION_CLIENT_SNIPPET} lang="ts" caption="instrumentation-client.ts" />
        <p>
          For page views, add a small client component that calls <code>useTrackPage</code> with{" "}
          <code>usePathname()</code>. Import <code>init</code> from{" "}
          <code>@telemetry-tracker/next</code> (not core) so <code>useTrackPage</code> sees the
          initialized SDK.
        </p>
        <CodeBlock code={LAYOUT_NO_PROVIDER_SNIPPET} lang="tsx" caption="app/layout.tsx" />
        <CodeBlock code={nextTrackPageView} lang="tsx" caption="app/track-page-view.tsx" />
        <p>
          <strong>Next.js 14 to 15.2:</strong> there is no <code>instrumentation-client.ts</code>, so
          use <code>TelemetryProvider</code> in the root layout as in the{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            Next.js docs
          </Link>{" "}
          and wrap <code>children</code> in <code>TelemetryErrorBoundary</code> inside it. Do not
          combine the provider with <code>instrumentation-client.ts</code> init. Known limitation in{" "}
          <code>@telemetry-tracker/next</code> 1.3.3: the provider shuts the SDK down when it
          unmounts, so a crash that replaces the root layout with <code>global-error.tsx</code> or
          the built-in error screen, or a crash during hydration, is not reported with provider-only
          init.
        </p>
        <CodeBlock code={nextProviderSetup} lang="tsx" caption="app/layout.tsx (Next.js 14 to 15.2)" />

        <h2 id="what-is-captured">Which Next.js errors are reported</h2>
        <p>
          A Next.js app fails in the browser and on the server, and not every failure reaches the same
          handler. With <code>init()</code> in <code>instrumentation-client.ts</code>:
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Error</th>
                <th className="px-4 py-3 font-medium">How it is reported</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Client render error caught by your <code>error.tsx</code></td>
                <td className="px-4 py-3 align-top">
                  Not automatic. Next.js only calls <code>console.error</code> in production;{" "}
                  <a href="#error-tsx" className="text-brand hover:underline">
                    call <code>trackError</code> in <code>error.tsx</code>
                  </a>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Client render error caught by your <code>global-error.tsx</code></td>
                <td className="px-4 py-3 align-top">
                  Not automatic.{" "}
                  <a href="#error-tsx" className="text-brand hover:underline">
                    Call <code>trackError</code> in <code>global-error.tsx</code>
                  </a>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Render or hydration crash with no error file of yours (built-in error screen)</td>
                <td className="px-4 py-3 align-top">
                  Automatic. Next.js passes it to <code>reportError</code> and the SDK&rsquo;s{" "}
                  <code>window.onerror</code> handler reports it
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Throw in an event handler or timeout</td>
                <td className="px-4 py-3 align-top">
                  Automatic through <code>window.onerror</code> (error boundaries do not catch these)
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Rejected promise nobody handles</td>
                <td className="px-4 py-3 align-top">
                  Automatic through <code>unhandledrejection</code>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Server Components, Route Handlers, Server Actions</td>
                <td className="px-4 py-3 align-top">
                  <a href="#server-errors" className="text-brand hover:underline">
                    <code>createOnRequestError</code> in <code>instrumentation.ts</code>
                  </a>{" "}
                  (Next.js 15+); the browser only gets a digest
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Error you catch yourself (try/catch, failed fetch)</td>
                <td className="px-4 py-3 align-top">
                  Call <code>trackError(error, context)</code> in the catch block
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We checked these paths on a Next.js 16.4 production build with{" "}
          <code>@telemetry-tracker/next</code> 1.3.3. Next.js 15.5 handles caught errors the same way.
        </p>

        <h2 id="error-tsx">Report errors caught by error.tsx and global-error.tsx</h2>
        <p>
          <code>error.tsx</code> wraps a route segment in a React error boundary and shows your
          fallback instead of a blank page. In production, Next.js then treats the error as handled
          and only logs it with <code>console.error</code>, so no global handler sees it. Report it
          from a <code>useEffect</code> in the file. If <code>error.digest</code> is set, the error
          happened on the server and <code>onRequestError</code> has already sent the real message
          and stack, so record a <code>server_error_shown</code> event instead of a second, stackless
          error. The{" "}
          <Link
            href="/error-tracking/nextjs/server-components-render-error"
            className="text-brand hover:underline"
          >
            Server Components render error guide
          </Link>{" "}
          explains the digest in detail.
        </p>
        <CodeBlock code={ERROR_TSX_SNIPPET} lang="tsx" caption="app/error.tsx" />
        <p>
          <code>global-error.tsx</code> catches errors in the root layout and anything no closer{" "}
          <code>error.tsx</code> handles. It replaces the root layout, so it renders its own{" "}
          <code>&lt;html&gt;</code> and <code>&lt;body&gt;</code>. With <code>init()</code> in{" "}
          <code>instrumentation-client.ts</code> the SDK is still running when it renders.
        </p>
        <CodeBlock code={GLOBAL_ERROR_SNIPPET} lang="tsx" caption="app/global-error.tsx" />
        <p>
          The SDK ignores a second report of the same <code>Error</code> object, so an error that
          also reaches <code>window.onerror</code> is sent once. Next.js 16 also passes{" "}
          <code>retry</code>; the samples keep <code>reset</code> so they typecheck on Next.js 15.
        </p>

        <h2>Verify your first error</h2>
        <p>
          Not required for production. Temporarily call{" "}
          <code>trackError(new Error(&quot;docs-check&quot;))</code> from a client button, then open{" "}
          <strong>Issues</strong>. Delete the verification helper afterward.
        </p>
        <CodeBlock code={nextDocsCheckButton} lang="tsx" caption="optional verification button" />
        <CodeBlock code={nextTestError} lang="typescript" caption="trackError call" />
        <p>
          To report render errors in one part of a page without an <code>error.tsx</code>, wrap it in{" "}
          <code>TelemetryErrorBoundary</code>:
        </p>
        <CodeBlock code={nextErrorBoundary} lang="tsx" caption="Error boundary" />

        <h2 id="server-errors">Server-side error tracking with Next.js App Router</h2>
        <p>
          Skip this section for browser-only setup. The browser SDK does not capture uncaught
          errors in Server Components, Route Handlers, or Server Actions. Add{" "}
          <code>instrumentation.ts</code> with <code>createOnRequestError</code> from{" "}
          <code>@telemetry-tracker/next/server</code> and the server-only variables below. That hook
          requires <strong>Next.js 15+</strong>. Use <code>TELEMETRY_API_KEY</code> — do not expose
          a server-only secret via <code>NEXT_PUBLIC_*</code>. Seeing{" "}
          <q>An error occurred in the Server Components render</q>?{" "}
          <Link
            href="/error-tracking/nextjs/server-components-render-error"
            className="text-brand hover:underline"
          >
            Find the real error behind the digest
          </Link>
          . Limits of the hook are on{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            the Next.js docs
          </Link>
          . Replacing <code>@sentry/nextjs</code> is covered in{" "}
          <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">
            Migrate from Sentry
          </Link>
          .
        </p>
        <CodeBlock code={nextEnvLocalServer} lang="bash" caption=".env.local (server)" />
        <CodeBlock code={nextInstrumentation} lang="ts" caption="instrumentation.ts" />

        <h2>Source maps</h2>
        <p>
          Set <code>productionBrowserSourceMaps: true</code>, keep the SDK <code>release</code> in
          sync with your upload, and follow{" "}
          <Link href="/docs/source-maps" className="text-brand hover:underline">
            Source maps
          </Link>{" "}
          (same guidance as <Link href="/docs/nextjs" className="text-brand hover:underline">/docs/nextjs</Link>
          ). Grouping still uses the minified stack; maps improve the frames you read in Issues.
        </p>

        <h2>What you will see</h2>
        <p>
          Open <strong>Issues</strong> in the dashboard. Matching stack traces are grouped into one
          issue with occurrences, release, and context. Optional spike alerts live under Alerts.
        </p>
        <p>
          The free hosted plan is €0 with no credit card: 250K ingest units per month, 14-day
          retention, one project. See{" "}
          <Link href="/pricing" className="text-brand hover:underline">
            pricing
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
          Custom events, identify, and more setup notes:{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            Next.js SDK docs
          </Link>
          . Hosted account steps:{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud
          </Link>
          .
        </p>

        <GuideCta />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/react",
              label: "React error tracking",
              description: "@telemetry-tracker/core for SPAs and Vite apps.",
            },
            {
              href: "/error-tracking/nodejs",
              label: "Node.js error tracking",
              description: "Uncaught exceptions on the server.",
            },
            {
              href: "/docs/nextjs",
              label: "Next.js docs",
              description: "Provider, error boundary, verify step, and server capture.",
            },
            {
              href: "/docs/source-maps",
              label: "Source maps",
              description: "Readable stacks for Next.js webpack and Turbopack builds.",
            },
            {
              href: "/docs/migrate-from-sentry",
              label: "Migrate from Sentry",
              description: "Replace @sentry/nextjs with this SDK.",
            },
            {
              href: "/sentry-alternative",
              label: "Sentry alternative",
              description: "When Telemetry Tracker is a better fit.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
