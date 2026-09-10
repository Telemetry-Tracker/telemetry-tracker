import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  breadcrumbJsonLd,
  howToJsonLd,
  marketingGuideMetadata,
  webPageJsonLd,
} from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";
import {
  nextErrorBoundary,
  nextInstall,
  nextProviderSetup,
  nextTestError,
  nextTrackPageView,
} from "@/lib/sdk-setup-snippets";

const PATH = "/error-tracking/nextjs";
const TITLE = "Next.js Error Tracking";
const DESCRIPTION =
  "Install @telemetry-tracker/next, wrap your app with TelemetryProvider, and see grouped Next.js errors in the dashboard. Free plan, no credit card.";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function NextJsErrorTrackingPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
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
                name: "Wrap the app with TelemetryProvider",
                text: "Pass the hosted ingest URL, app name, and API key. Call useTrackPage with the pathname from next/navigation.",
              },
              {
                name: "Send a test error",
                text: "Call trackError or throw inside TelemetryErrorBoundary, then open Issues in the dashboard.",
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
            <code>@telemetry-tracker/next</code> wraps the core SDK for App Router apps: a provider
            that calls <code>init()</code>, an error boundary for React render errors, and{" "}
            <code>useTrackPage</code> for route changes. Uncaught browser errors and unhandled promise
            rejections are reported after init.
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
            <code>TelemetryProvider</code> initializes the SDK once for the tree.
          </li>
          <li>
            Browser uncaught errors and unhandled rejections are sent automatically.
          </li>
          <li>
            <code>TelemetryErrorBoundary</code> reports React render errors and can show a fallback.
          </li>
          <li>
            <code>useTrackPage(pathname)</code> sends a screen event on each route change.
          </li>
          <li>
            <code>trackError</code>, <code>trackEvent</code>, <code>screen</code>, and{" "}
            <code>identify</code> are re-exported from the same package.
          </li>
        </ul>

        <h2>Install</h2>
        <CodeBlock code={nextInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>
          Wrap the root layout with <code>TelemetryProvider</code>. Put{" "}
          <code>usePathname()</code> in a client component — layouts are often server components.
        </p>
        <CodeBlock code={nextProviderSetup} lang="tsx" caption="app/layout.tsx" />
        <CodeBlock code={nextTrackPageView} lang="tsx" caption="app/track-page-view.tsx" />
        <p>
          Create a project API key under Settings → API keys and set{" "}
          <code>NEXT_PUBLIC_TELEMETRY_API_KEY</code>. Keys are shown once at creation.
        </p>

        <h2>Send a test error</h2>
        <p>
          After init, call <code>trackError</code> from a client component (for example a button
          handler) or throw inside an error boundary:
        </p>
        <CodeBlock code={nextTestError} lang="typescript" caption="Test error" />
        <CodeBlock code={nextErrorBoundary} lang="tsx" caption="Error boundary" />

        <h2>What you will see</h2>
        <p>
          Open <strong>Issues</strong> in the dashboard. Matching stack traces are grouped into one
          issue with occurrences, release, and context. Upload source maps under Settings → Source
          maps (same <code>release</code> as the SDK) if you want symbolicated frames instead of
          minified lines. Optional spike alerts live under Alerts.
        </p>
        <p>
          The free hosted plan is €0 with no credit card: 250K ingest units per month, 14-day
          retention, one project. See{" "}
          <Link href="/#pricing" className="text-brand hover:underline">
            pricing
          </Link>
          .
        </p>

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
              description: "Provider, error boundary, and page tracking.",
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
