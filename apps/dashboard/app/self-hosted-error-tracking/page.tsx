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

const PATH = "/self-hosted-error-tracking";
const TITLE = "Self-Hosted Error Tracking";
const DESCRIPTION =
  "Self-host Telemetry Tracker: MIT-licensed Fastify API, Next.js dashboard, and PostgreSQL. Same SDKs as the hosted cloud, data in your database.";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function SelfHostedErrorTrackingPage() {
  const origin = marketingSiteOrigin();

  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({ origin, path: PATH, name: TITLE, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "Self-hosted error tracking", path: PATH },
          ]),
        ]}
      />
      <MarketingGuideLayout
        kicker="Self-hosting"
        title="Self-hosted error tracking"
        lede={
          <p>
            Telemetry Tracker is MIT-licensed. You can run the ingest API and dashboard on
            infrastructure you control, with telemetry in your own PostgreSQL. The npm SDKs are the
            same ones used on the hosted cloud — you only change <code>ingestUrl</code>.
          </p>
        }
      >
        <h2>What you run</h2>
        <p>Three pieces, documented in the repository:</p>
        <ul>
          <li>
            <strong>PostgreSQL</strong> — required by the API.
          </li>
          <li>
            <strong>API</strong> (<code>apps/api</code>) — Fastify ingest and read API.
          </li>
          <li>
            <strong>Dashboard</strong> (<code>apps/dashboard</code>) — Next.js UI. It talks to the
            API via server-side <code>API_URL</code>.
          </li>
        </ul>
        <p>
          Repo layout and env vars live in{" "}
          <a
            href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/DEPLOYMENT.md"
            className="text-brand hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            DEPLOYMENT.md
          </a>
          . The dashboard Dockerfile is at the repo root; the API has no Dockerfile in this
          repository, so you deploy that process yourself (or compose it beside Postgres).
        </p>

        <h2>Hosted cloud vs self-host</h2>
        <p>
          Use{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            hosted cloud
          </Link>{" "}
          if you want to skip ops: register, create a project, point SDKs at{" "}
          <code>https://api.telemetry-tracker.com</code>. The free plan needs no credit card.
        </p>
        <p>
          Self-host if you need data residency, air-gapped networks, or you simply prefer to
          operate the stack. You are then responsible for uptime, backups, TLS, and upgrades. Stripe
          billing and Resend email are optional on your deployment; they are not required to ingest
          errors.
        </p>

        <h2>High-level setup</h2>
        <ol>
          <li>
            Clone{" "}
            <a
              href="https://github.com/Telemetry-Tracker/telemetry-tracker"
              className="text-brand hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              the repository
            </a>{" "}
            and copy the API and dashboard <code>.env.example</code> files.
          </li>
          <li>
            Set <code>DATABASE_URL</code> on the API. Run migrations (
            <code>pnpm db:migrate</code> in development).
          </li>
          <li>
            Set dashboard <code>API_URL</code> to your API origin. In production, set API{" "}
            <code>CORS_ORIGINS</code> / <code>DASHBOARD_ORIGIN</code> to the dashboard origin.
          </li>
          <li>
            Create an org, project, and API key in the dashboard, then init an SDK with your ingest
            URL.
          </li>
        </ol>
        <p>
          Ingest is authenticated with project API keys. Do not enable unauthenticated ingest in
          production. Details, health checks, and optional PII scrubbing flags are in DEPLOYMENT.md
          and the{" "}
          <Link href="/docs#self-hosting" className="text-brand hover:underline">
            self-hosting docs
          </Link>
          .
        </p>

        <h2>Point an SDK at your API</h2>
        <p>
          Same packages as hosted: <code>@telemetry-tracker/next</code>,{" "}
          <code>@telemetry-tracker/core</code>, <code>@telemetry-tracker/node</code>,{" "}
          <code>@telemetry-tracker/react-native</code>. Set <code>ingestUrl</code> to your API base
          (no trailing slash) and pass <code>apiKey</code>. Framework walkthroughs:
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

        <h2>What you get in the dashboard</h2>
        <p>
          Issues (grouped errors), events, sessions, performance / Web Vitals, releases, search,
          and alerts — the same UI as hosted. Retention and quotas follow however you configure the
          deployment; hosted plan limits apply only on telemetry-tracker.com.
        </p>

        <GuideCta
          heading="Prefer not to operate Postgres?"
          body="The hosted free plan uses the same SDKs. Register, copy a key, and send the first error without standing up the API."
        />
        <GuideRelatedLinks
          links={[
            {
              href: "/docs#self-hosting",
              label: "Self-hosting in the docs",
              description: "Monorepo layout and upgrade notes.",
            },
            {
              href: "/docs/hosted-cloud",
              label: "Hosted cloud",
              description: "Managed ingest if you skip self-hosting.",
            },
            {
              href: "/sentry-alternative",
              label: "Sentry alternative",
              description: "Where this product fits versus a larger platform.",
            },
            {
              href: "/docs/releases",
              label: "Release notes",
              description: "Version-to-version upgrade paths.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
