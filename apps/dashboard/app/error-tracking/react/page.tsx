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
import { reactInstall, reactSetup, reactTestError } from "@/lib/sdk-setup-snippets";

const PATH = "/error-tracking/react";
const TITLE = "React Error Tracking: Error Boundaries, React 19 and Source Maps";
const DESCRIPTION =
  "React error tracking setup: what init() catches, how to report error boundary errors (React 19 onCaughtError, React 18 componentDidCatch) and Vite source maps.";

const REACT19_ROOT_SNIPPET = `// main.tsx
import { createRoot } from "react-dom/client";
import { init, trackError } from "@telemetry-tracker/core";
import App from "./App";

init({
  ingestUrl: "https://api.telemetry-tracker.com",
  app: "my-react-app",
  apiKey: "tt_live_<publicId>_<secret>",
  release: import.meta.env.VITE_APP_RELEASE, // same string as the source map upload
});

const root = createRoot(document.getElementById("root")!, {
  // React 19 only logs boundary-caught errors to the console by default.
  onCaughtError: (error, errorInfo) => {
    console.error(error);
    trackError(error, {
      source: "react.onCaughtError",
      componentStack: errorInfo.componentStack,
    });
  },
});
root.render(<App />);`;

const REACT18_BOUNDARY_SNIPPET = `// ErrorBoundary.tsx (React 16.8+ / 18)
import { Component, type ErrorInfo, type ReactNode } from "react";
import { trackError } from "@telemetry-tracker/core";

type Props = { fallback: ReactNode; children: ReactNode };

export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackError(error, {
      source: "react.ErrorBoundary",
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}`;

const VITE_SOURCEMAPS_SNIPPET = `// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { telemetrySourceMaps } from "@telemetry-tracker/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    react(),
    telemetrySourceMaps({
      apiKey: process.env.TT_API_KEY!, // CI key with source map upload enabled
      projectId: process.env.TT_PROJECT_ID!,
      release: process.env.VITE_APP_RELEASE ?? "dev", // must match init({ release })
      app: "my-react-app", // must match init({ app })
      baseUrl: "https://app.example.com",
      deleteMapsAfterUpload: true,
    }),
  ],
});`;

const FAQ = [
  {
    question: "Does Telemetry Tracker catch React render errors automatically?",
    answer:
      "Only the ones no error boundary catches. In React 19 those go to the browser's reportError, and React 18 rethrows them, so the window.onerror handler that init() installs reports them. Errors an error boundary catches are handled by React and never reach window, so report them with onCaughtError (React 19) or componentDidCatch (React 18).",
  },
  {
    question: "Are errors in event handlers and async code reported?",
    answer:
      "Yes, if nothing catches them. Error boundaries do not catch errors in event handlers, timeouts or promises, so a throw in onClick reaches window.onerror and an unhandled rejection reaches the unhandledrejection handler. If you catch the error yourself, call trackError in the catch block.",
  },
  {
    question: "Will an error be reported twice if both a boundary and the global handler see it?",
    answer:
      "No. The SDK remembers each Error object it has sent and ignores a second report of the same object, so calling trackError in a boundary does not create a duplicate if the same error also reaches window.onerror (for example in React 18 development builds).",
  },
  {
    question: "Should I set onUncaughtError in React 19?",
    answer:
      "You do not have to. React's default sends uncaught errors to reportError, which the SDK already listens to. If you set onUncaughtError for your own logging, React no longer calls reportError, so call trackError inside your handler too.",
  },
  {
    question: "Why are my React stack traces minified?",
    answer:
      "Production builds ship minified bundles. Build with source maps and upload them with @telemetry-tracker/vite-plugin (or the GitHub Action), using the same app and release strings you pass to init().",
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

export default function ReactErrorTrackingPage() {
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
            { name: "React error tracking", path: PATH },
          ]),
          howToJsonLd({
            name: "Set up React error tracking with Telemetry Tracker",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Create a free account",
                text: "Register, create a project, and copy a tt_live API key. No credit card is required.",
              },
              {
                name: "Install the core SDK",
                text: "Add @telemetry-tracker/core to your React app.",
              },
              {
                name: "Call init at app entry",
                text: "Pass the hosted ingest URL, app name, and API key before rendering the tree.",
              },
              {
                name: "Report errors caught by error boundaries",
                text: "On React 19 pass onCaughtError to createRoot; on React 18 call trackError in your boundary's componentDidCatch.",
              },
              {
                name: "Send a test error",
                text: "Call trackError, then open Issues in the dashboard.",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title="React error tracking"
        updated="2026-11"
        lede={
          <p>
            React SPAs use <code>@telemetry-tracker/core</code>. Call <code>init()</code> once at
            startup. After that, uncaught errors and unhandled promise rejections in the browser are
            reported automatically. Errors that an error boundary catches are not: React handles
            them, so add one <code>trackError</code> call in <code>onCaughtError</code> (React 19) or{" "}
            <code>componentDidCatch</code> (React 18). Use <code>trackError</code> for handled
            exceptions too.
          </p>
        }
      >
        <p>
          Next.js apps should use{" "}
          <Link href="/error-tracking/nextjs" className="text-brand hover:underline">
            @telemetry-tracker/next
          </Link>{" "}
          instead (provider, error boundary, page hook). Vue and Nuxt also use core — see the{" "}
          <Link href="/docs/vue" className="text-brand hover:underline">
            Vue
          </Link>{" "}
          and{" "}
          <Link href="/docs/nuxt" className="text-brand hover:underline">
            Nuxt
          </Link>{" "}
          docs. This page is the React / Vite path.
        </p>

        <h2>What the integration does</h2>
        <ul>
          <li>
            <code>init()</code> starts batching to the ingest API.
          </li>
          <li>Global browser handlers capture uncaught errors after init.</li>
          <li>
            <code>trackError</code> sends handled errors with optional context.
          </li>
          <li>
            <code>trackEvent</code>, <code>screen</code>, and <code>identify</code> cover product
            events, page views, and user identity.
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
          snapshot. Set <code>webVitals: false</code> in <code>init()</code> config to turn capture off.
          Each reported metric is an event and counts as one ingest unit toward your plan limit.
          These are browser measurements, not native React Native or Node.js server metrics.
        </p>
        <p>
          See the{" "}
          <Link href="/docs/sdk#sdk-web-vitals-heading" className="text-brand hover:underline">
            Web Vitals configuration and limitations
          </Link>
          .
        </p>

        <h2>Install</h2>
        <CodeBlock code={reactInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>
          Initialize at app entry (for example <code>main.tsx</code>) with the hosted ingest URL and
          your project API key:
        </p>
        <CodeBlock code={reactSetup} lang="typescript" caption="init and helpers" />
        <p>
          Required config: <code>ingestUrl</code> and <code>app</code>. Hosted cloud also needs{" "}
          <code>apiKey</code>. Optional: <code>environment</code>, <code>release</code>,{" "}
          <code>piiScrub</code>.
        </p>

        <h2>Send a test error</h2>
        <p>
          Trigger this from a click handler, then open Issues. If nothing appears, confirm the key
          and that ingest is <code>https://api.telemetry-tracker.com</code>.
        </p>
        <CodeBlock code={reactTestError} lang="typescript" caption="Test error" />

        <h2 id="what-is-captured">Which React errors are reported</h2>
        <p>
          A React app fails in several places, and they do not all reach the same handler. This is
          what <code>@telemetry-tracker/core</code> reports on its own and what you add:
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
                <td className="px-4 py-3 align-top">Render error that no error boundary catches</td>
                <td className="px-4 py-3 align-top">
                  Automatic. React 19 passes it to <code>reportError</code>, React 18 rethrows it, and
                  the SDK&rsquo;s <code>window.onerror</code> handler reports it
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Render error caught by an error boundary</td>
                <td className="px-4 py-3 align-top">
                  Not automatic. Add{" "}
                  <a href="#error-boundaries" className="text-brand hover:underline">
                    <code>onCaughtError</code> or <code>componentDidCatch</code>
                  </a>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Throw in an event handler or timeout</td>
                <td className="px-4 py-3 align-top">
                  Automatic through <code>window.onerror</code> (boundaries do not catch these)
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Rejected promise nobody handles</td>
                <td className="px-4 py-3 align-top">
                  Automatic through <code>unhandledrejection</code>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Error you catch yourself (try/catch, failed fetch)</td>
                <td className="px-4 py-3 align-top">
                  Call <code>trackError(error, context)</code> in the catch block
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">
                  Error React recovers from (React 19 <code>onRecoverableError</code>)
                </td>
                <td className="px-4 py-3 align-top">
                  Automatic while you keep React&rsquo;s default handler, which calls{" "}
                  <code>reportError</code>; it arrives without a component stack
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 id="error-boundaries">Report errors caught by error boundaries</h2>
        <p>
          An error boundary shows a fallback instead of a blank screen. In production builds React
          then treats the error as handled: React 19 only logs it with <code>console.error</code>,
          and React 18 does not rethrow it to <code>window</code>. No global handler sees it, so
          without one extra call these errors never reach Issues.
        </p>
        <p>
          <strong>React 19:</strong> pass <code>onCaughtError</code> to <code>createRoot</code> (or{" "}
          <code>hydrateRoot</code>). It runs for every boundary in the tree, so you do not change
          your boundary components.
        </p>
        <CodeBlock code={REACT19_ROOT_SNIPPET} lang="tsx" caption="React 19: report boundary-caught errors" />
        <p>
          Leave <code>onUncaughtError</code> at React&rsquo;s default. If you set it for your own
          logging, React no longer calls <code>reportError</code>, so call <code>trackError</code>{" "}
          inside it as well.
        </p>
        <p>
          <strong>React 18 and earlier:</strong> report from the boundary&rsquo;s{" "}
          <code>componentDidCatch</code>. If you use the <code>react-error-boundary</code> package,
          call <code>trackError</code> in its <code>onError</code> prop instead.
        </p>
        <CodeBlock code={REACT18_BOUNDARY_SNIPPET} lang="tsx" caption="React 18: error boundary with trackError" />
        <ul>
          <li>
            <strong>No duplicates:</strong> the SDK ignores a second report of the same{" "}
            <code>Error</code> object, so an error that reaches both your boundary and{" "}
            <code>window.onerror</code> (as can happen in React 18 development builds) is sent once.
          </li>
          <li>
            <strong>Component stack:</strong> there is no dedicated field yet, so it is sent as
            error context and shown with the other context on the issue. Context strings are
            truncated at 16 KB at ingest.
          </li>
          <li>
            <strong>Who was affected:</strong> call <code>identify(userId)</code> after login so
            later errors carry the user ID. Hosted ingest applies best-effort PII scrubbing by
            default; <code>piiScrub: true</code> in <code>init()</code> also redacts common secrets
            in the browser before sending (opt-in; see{" "}
            <Link href="/docs/sdk-privacy" className="text-brand hover:underline">
              SDK privacy
            </Link>
            ).
          </li>
        </ul>

        <h2 id="source-maps">Readable stack traces with Vite source maps</h2>
        <p>
          Production React builds are minified, so raw stacks point at <code>index-a1b2c3.js:1</code>.
          Build with source maps and upload them after each build with{" "}
          <code>@telemetry-tracker/vite-plugin</code>. Use a CI API key with source map upload
          enabled (not the browser ingest key) and the project UUID from Settings. The{" "}
          <code>app</code> and <code>release</code> values must match what you pass to{" "}
          <code>init()</code>, or the stack cannot be mapped.
        </p>
        <CodeBlock code={VITE_SOURCEMAPS_SNIPPET} lang="typescript" caption="vite.config.ts" />
        <p>
          <code>deleteMapsAfterUpload</code> removes the <code>.map</code> files from{" "}
          <code>dist</code> once every upload succeeds, so they are not served publicly. The Free
          plan keeps up to 25 source map artifacts per project. Not on Vite? Use the GitHub Action
          or the API described in{" "}
          <Link href="/docs/source-maps" className="text-brand hover:underline">
            source maps
          </Link>
          .
        </p>

        <h2>What it does not do</h2>
        <ul>
          <li>No session replay and no distributed tracing.</li>
          <li>
            Not compatible with the Sentry SDK: you replace <code>@sentry/react</code> with the core
            SDK rather than changing a DSN. See{" "}
            <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">
              Migrate from Sentry
            </Link>
            .
          </li>
          <li>
            Server-rendered React on Next.js needs <code>@telemetry-tracker/next</code> for server
            errors; this page covers client-side React.
          </li>
        </ul>

        <h2>What you will see</h2>
        <p>
          Errors are fingerprinted and grouped. The issue view shows stack, occurrence count, and
          context you passed to <code>trackError</code>. Sessions and events from the same{" "}
          <code>app</code> string show up in the same project filters.
        </p>
        <p>
          Free hosted plan: €0, no credit card, 250K ingest units per month, 14-day retention, one
          project.{" "}
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
          <Link href="/docs/sdk" className="text-brand hover:underline">
            SDK reference
          </Link>{" "}
          for init options, identity, and PII scrubbing.{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud
          </Link>{" "}
          for account and API key steps.
        </p>

        <GuideCta />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/nextjs",
              label: "Next.js error tracking",
              description: "Provider, error boundary, and App Router page views.",
            },
            {
              href: "/error-tracking/react-native",
              label: "React Native error tracking",
              description: "ErrorUtils, sessions, and screens.",
            },
            {
              href: "/docs/source-maps",
              label: "Source maps",
              description: "Upload maps per app and release for readable stacks.",
            },
            {
              href: "/sentry-alternative",
              label: "Sentry alternative",
              description: "How Telemetry Tracker compares for React apps.",
            },
            {
              href: "/self-hosted-error-tracking",
              label: "Self-hosted error tracking",
              description: "Run the same SDK against your own API.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
