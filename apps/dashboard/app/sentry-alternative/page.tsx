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
  "Open-source Sentry alternative for side projects: grouped errors, events, and sessions. Compare privacy and data collection defaults, migrate from Sentry, or self-host the MIT stack.";

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

        <h2>What Telemetry Tracker collects by default</h2>
        <p>
          If you are evaluating a Sentry alternative for privacy or planning to migrate from Sentry,
          review the payloads as well as the SDK setup. Telemetry Tracker’s SDKs do not automatically
          capture your application’s HTTP request headers, cookies, or request bodies. Node middleware
          can include request bodies if you explicitly enable <code>trackRequestBody</code>.
        </p>
        <ul>
          <li>
            Errors include messages and stack traces; custom error context and event properties you
            send are stored after ingest scrubbing. App, environment, and release metadata accompany
            payloads when configured. Browser initialization also captures unhandled errors and, by default,
            Web Vitals performance events.
          </li>
          <li>
            Browser sessions include an SDK-generated anonymous id (persisted in localStorage when available),
            start/end markers, coarse browser and OS hints, and a country hint derived from locale, not IP geolocation. A user id and
            optional user email are stored when you send them with <code>identify</code>.
          </li>
          <li>
            There is no dedicated IP address field in the telemetry ingest schema or session storage.
            Source maps are stored when you upload them and may contain source paths and code.
          </li>
          <li>
            Server-side PII scrubbing at ingest is on by default for error messages, stacks, context,
            and event properties. Self-hosters can disable it. Client-side <code>piiScrub</code> is
            available in the core SDK but is off by default.
          </li>
        </ul>
        <p>
          <strong>Scrubbing is best effort.</strong> It cannot detect every personal identifier or
          secret. Session identity fields are not scrubbed by default; session email redaction requires
          the separate project setting <code>scrubSessionUserEmail</code> and enabled ingest scrubbing.
          Source map contents are not passed through the ingest PII scrubber. Client-side scrubbing
          does not currently remove URL query strings in full, although it redacts recognized sensitive
          parameters. Node middleware records request URLs, so avoid sending sensitive values in URLs,
          messages, stacks, or custom properties. Review what you send before enabling capture.
        </p>
        <p>
          Sentry’s JavaScript v11 migration guide lists broader defaults when <code>dataCollection</code>
          is unset: user information, cookies, request/response bodies, database query data, and GenAI
          inputs/outputs are enabled. Actual capture depends on runtime and integrations. Sentry retains
          sensitive-data filtering and lets you configure each category, including settings to preserve
          v10’s defaults. See the{" "}
          <a
            href="https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#senddefaultpii-is-replaced-by-datacollection"
            className="text-brand hover:underline"
          >
            Sentry v11 migration guide
          </a>
          {" "}before upgrading or comparing collection settings.
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
