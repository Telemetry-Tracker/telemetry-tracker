import Link from "next/link";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  breadcrumbJsonLd,
  marketingGuideMetadata,
  webPageJsonLd,
} from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";

const PATH = "/sentry-alternative";
const TITLE = "Open Source Sentry Alternative";
const DESCRIPTION =
  "Open-source Sentry alternative for side projects: grouped errors, events, and sessions. Free hosted plan, no credit card, or self-host the MIT stack.";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function SentryAlternativePage() {
  const origin = marketingSiteOrigin();

  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({ origin, path: PATH, name: TITLE, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "Sentry alternative", path: PATH },
          ]),
        ]}
      />
      <MarketingGuideLayout
        kicker="Compare"
        title="A smaller, open-source Sentry alternative"
        lede={
          <p>
            Sentry is a full observability platform used by large teams. Telemetry Tracker is a
            narrower tool: catch application errors, inspect grouped issues, and optionally track
            events and sessions — without adopting that whole stack. It is a better fit when you
            want something you can install in minutes on a side project.
          </p>
        }
      >
        <h2>Who this is for</h2>
        <p>Telemetry Tracker is built for:</p>
        <ul>
          <li>Side projects and weekend apps that still need real error grouping.</li>
          <li>Indie developers who do not want a credit card on file to try ingest.</li>
          <li>Small teams that want one dashboard for errors, events, and sessions.</li>
          <li>
            People who want to{" "}
            <Link href="/self-hosted-error-tracking" className="text-brand hover:underline">
              self-host
            </Link>{" "}
            an MIT-licensed API and dashboard, or use the official cloud at
            telemetry-tracker.com.
          </li>
        </ul>
        <p>
          If you already rely on Sentry for session replay, distributed tracing, a wide language
          matrix, or a large existing integration surface, stay there. This page is not a
          feature-parity checklist.
        </p>

        <h2>What Telemetry Tracker actually does</h2>
        <ul>
          <li>
            <strong>Error tracking</strong> — fingerprint and group exceptions, inspect stacks,
            symbolicate when you upload source maps.
          </li>
          <li>
            <strong>Events</strong> — structured <code>trackEvent</code> payloads you can filter in
            the dashboard.
          </li>
          <li>
            <strong>Sessions</strong> — start/end of a visit, not video replay.
          </li>
          <li>
            <strong>Alerts</strong> — in-app notifications, email, HTTPS webhooks, Slack, Discord
            and Telegram. Slack, Discord, and Telegram use incoming webhook or bot URLs, not OAuth
            apps. The dashboard rule editor currently authors error-count conditions.
          </li>
          <li>
            <strong>Releases and Web Vitals</strong> — release filters and performance views in the
            dashboard.
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

        <h2>Supported SDKs</h2>
        <p>
          First-class packages today: Next.js (client-side and App Router server errors when
          configured), React (core), Node.js, NestJS (via the Node package), Vue and Nuxt (core),
          and React Native. There is no Python, Go, PHP, Ruby, or native iOS/Android SDK.
        </p>
        <ul>
          <li>
            <Link href="/error-tracking/nextjs" className="text-brand hover:underline">
              Next.js
            </Link>
          </li>
          <li>
            <Link href="/error-tracking/react" className="text-brand hover:underline">
              React
            </Link>
          </li>
          <li>
            <Link href="/error-tracking/nodejs" className="text-brand hover:underline">
              Node.js
            </Link>
          </li>
          <li>
            <Link href="/error-tracking/react-native" className="text-brand hover:underline">
              React Native
            </Link>
          </li>
        </ul>

        <h2>Hosted free plan vs running it yourself</h2>
        <p>
          The official cloud has a free tier at €0: 250K ingest units per month, 14-day retention,
          one project, two API keys. No credit card to register. Ingest stops at the plan cap —
          there is no automatic overage bill.{" "}
          <Link href="/pricing" className="text-brand hover:underline">
            Pro and Business
          </Link>{" "}
          raise volume and retention if you outgrow that.
        </p>
        <p>
          The same codebase is MIT-licensed. Self-host if you want data in your Postgres and no
          hosted vendor. That means you operate the API, dashboard, and database — see{" "}
          <Link href="/self-hosted-error-tracking" className="text-brand hover:underline">
            self-hosted error tracking
          </Link>
          .
        </p>

        <h2>Migrating from Sentry</h2>
        <p>
          Pointing a Sentry DSN at Telemetry Tracker does not work. You remove the Sentry SDK and
          call Telemetry Tracker instead. The step-by-step map, Next.js setup, and the list of what
          does not come across are in{" "}
          <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">
            Migrate from Sentry
          </Link>
          .
        </p>

        <h2>Getting the first error in</h2>
        <ol>
          <li>
            <Link href="/register" className="text-brand hover:underline">
              Create an account
            </Link>{" "}
            and a project.
          </li>
          <li>Copy an API key (shown once).</li>
          <li>
            Install the SDK for your stack and set ingest to{" "}
            <code>https://api.telemetry-tracker.com</code>.
          </li>
          <li>
            Call <code>trackError</code> or throw once, then open Issues.
          </li>
        </ol>
        <p>
          Step-by-step:{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud getting started
          </Link>
          .
        </p>

        <GuideCta
          heading="Try it on a side project"
          body="Install an SDK, send one error, and decide from the Issues view — not from a sales call."
        />
        <GuideRelatedLinks
          heading="Keep reading"
          links={[
            {
              href: "/docs/migrate-from-sentry",
              label: "Migrate from Sentry",
              description: "Replace the Sentry SDK, including Next.js.",
            },
            {
              href: "/self-hosted-error-tracking",
              label: "Self-hosted error tracking",
              description: "Fastify API, Next.js dashboard, Postgres.",
            },
            {
              href: "/error-tracking/nextjs",
              label: "Next.js setup",
              description: "Most common hosted path.",
            },
            {
              href: "/docs",
              label: "Documentation",
              description: "Quickstart, ingest API, and platform guides.",
            },
            {
              href: "/pricing",
              label: "Pricing",
              description: "Free, Pro, and Business in EUR.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
