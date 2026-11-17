import Link from "next/link";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  marketingGuideMetadata,
  webPageJsonLd,
} from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";

const PATH = "/self-hosted-error-tracking";
const TITLE = "Self-Hosted Error Tracking (On-Prem, Air-Gapped)";
const DESCRIPTION =
  "Self-host Telemetry Tracker on-prem or air-gapped: MIT-licensed, three containers, what connects out, offline install with docker save/load, and the limits.";

const FAQ = [
  {
    question: "Can Telemetry Tracker run in an air-gapped network?",
    answer:
      "Yes, for error and event ingest and the dashboard. The stack makes no outbound calls of its own: email (Resend), billing (Stripe), Sentry, Google Analytics and webhook alerts only connect out when you configure them. Images are built from source, so you build them on a connected machine and copy them across. Email and webhook alerts need a reachable destination; see the limits on this page.",
  },
  {
    question: "Does the self-hosted version send stack traces or telemetry back to Telemetry Tracker?",
    answer:
      "No. SDKs send only to the ingestUrl you set (it has no default), and errors are stored in your PostgreSQL. Google Analytics loads only on the telemetry-tracker.com host or when NEXT_PUBLIC_GA_MEASUREMENT_ID is set, and the dashboard images build with NEXT_TELEMETRY_DISABLED=1. One exception to configure: the Vite source-map plugin uploads to the hosted API unless you set baseApiUrl.",
  },
  {
    question: "What hardware does self-hosted Telemetry Tracker need?",
    answer:
      "In our measured Docker Compose install (8 vCPU test box), the three containers used about 261 MiB of memory at idle, and the images took about 1.2 GB of disk plus a 3.6 GB build cache. Those numbers come from one setup and are not guarantees. For comparison, Sentry documents a minimum of 4 CPU cores, 16 GB RAM plus 16 GB swap and 20 GB disk for self-hosted Sentry.",
  },
  {
    question: "Which data stays in my network when I self-host?",
    answer:
      "Everything the SDKs send: errors with stack traces, events, sessions, Web Vitals, releases and source maps uploaded to your own API. They live in your PostgreSQL database, so backups, retention (the nightly retention job) and access control follow your own policies.",
  },
] as const;

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
          faqPageJsonLd(FAQ),
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
        updated="2026-11"
        lede={
          <p>
            Telemetry Tracker is MIT-licensed. You can run the ingest API and dashboard on
            infrastructure you control, with telemetry in your own PostgreSQL. The npm SDKs are the
            same ones used on the hosted cloud — you only change <code>ingestUrl</code>. It runs
            on-prem and in air-gapped networks, with the limits listed below.
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
          . For a single host, <code>selfhost/</code> starts Postgres, the API and the dashboard
          with one <code>docker compose up -d</code>. See{" "}
          <Link href="/docs/self-hosting" className="text-brand hover:underline">
            self-hosting
          </Link>
          .
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

        <h2>Air-gapped and data-residency checklist</h2>
        <p>
          Checked against the v1.22 source. At runtime the stack does not phone home: each outbound
          connection below exists only if you configure it. Plan for two exceptions: the source-map
          plugin&apos;s default upload target and the image build.
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Component</th>
                <th className="px-4 py-3 font-medium">Connects outside your network?</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">SDKs (browser, Node.js, React Native)</td>
                <td className="px-4 py-3 align-top">
                  Only to the <code>ingestUrl</code> you pass. It is required and has no default.
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">
                  Source-map upload (<code>@telemetry-tracker/vite-plugin</code>)
                </td>
                <td className="px-4 py-3 align-top">
                  Defaults to the hosted API. Set <code>baseApiUrl</code> to your API so maps never
                  leave the network.
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">API</td>
                <td className="px-4 py-3 align-top">
                  No. Email (Resend), billing (Stripe) and Sentry are off unless{" "}
                  <code>RESEND_API_KEY</code>, Stripe keys or <code>SENTRY_DSN</code> are set.
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Dashboard</td>
                <td className="px-4 py-3 align-top">
                  No. Fonts are bundled, Google Analytics loads only on telemetry-tracker.com or
                  with <code>NEXT_PUBLIC_GA_MEASUREMENT_ID</code>, and Next.js telemetry is
                  disabled in the image.
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Alert webhooks (Slack, Discord, Telegram, HTTPS)</td>
                <td className="px-4 py-3 align-top">
                  Only to the destinations you add, over HTTPS.
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Docker image build</td>
                <td className="px-4 py-3 align-top">
                  Yes: it pulls base images and npm packages. Build on a connected machine (see
                  below).
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Install on a host without internet</h2>
        <p>
          No prebuilt images are published yet, so the images are built from the repository. Build
          them once on a machine with internet access and move them across:
        </p>
        <ol>
          <li>
            On the connected machine, in <code>selfhost/</code>: copy <code>.env.example</code> to{" "}
            <code>.env</code>, fill in the three secrets (Compose checks them for every command)
            and set <code>DASHBOARD_URL</code>, which is baked into the dashboard image. Then run{" "}
            <code>docker compose build</code> and <code>docker pull postgres:16-alpine</code>.
          </li>
          <li>
            Save the three images:{" "}
            <code>
              docker save telemetry-tracker-api:local telemetry-tracker-dashboard:local
              postgres:16-alpine -o telemetry-tracker-images.tar
            </code>
            .
          </li>
          <li>
            Copy the tar file, the repository checkout and <code>selfhost/.env</code> to the offline
            host, then run <code>docker load -i telemetry-tracker-images.tar</code>.
          </li>
          <li>
            In <code>selfhost/</code>, start with <code>docker compose up -d --no-build</code>. The
            API applies database migrations itself on start.
          </li>
        </ol>
        <p>Upgrades repeat the same steps with a newer checkout.</p>

        <h2>Limits to know before an air-gapped install</h2>
        <ul>
          <li>
            <strong>Email</strong> (invites, password reset, alert emails) is sent through Resend, an
            external API. Without outbound access to it, invite links and alerts are not emailed;
            issues are still in the dashboard.
          </li>
          <li>
            <strong>Webhook alerts</strong> must use HTTPS. To protect against SSRF, the API rejects{" "}
            <code>localhost</code>, <code>.local</code> and <code>.internal</code> hostnames and
            private or loopback IP addresses, so a receiver that is only reachable on a private
            network cannot be used today.
          </li>
          <li>
            <strong>Background jobs</strong> are separate processes from the same API image:
            scheduled alert rules (<code>docker compose --profile jobs up -d</code>), nightly
            retention, and the webhook delivery worker (
            <code>node dist/jobs/run-alert-webhook-worker.js</code>, not part of the Compose stack
            yet).
          </li>
          <li>
            <strong>You operate it:</strong> TLS, backups (keep <code>CHECKIN_ENCRYPTION_KEY</code>{" "}
            with them), upgrades and monitoring are yours.
          </li>
        </ul>

        <h2>How it compares with other self-hosted error trackers</h2>
        <ul>
          <li>
            <strong>Sentry self-hosted</strong> is the full Sentry platform on Docker Compose.
            Sentry documents a minimum of 4 CPU cores, 16 GB RAM plus 16 GB swap and 20 GB of
            disk, and licenses it under the FSL (
            <a
              href="https://develop.sentry.dev/self-hosted/"
              className="text-brand hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sentry self-hosted docs
            </a>
            ). Choose it when you need Sentry&apos;s full feature set and can run that stack.
          </li>
          <li>
            <strong>Telemetry Tracker</strong> is three containers: PostgreSQL, the API and the
            dashboard. In our measured install they used about 261 MiB of memory at idle (details
            in the{" "}
            <Link href="/docs/self-hosting" className="text-brand hover:underline">
              self-hosting docs
            </Link>
            ). It covers errors, events, sessions, Web Vitals, releases and alerts, and is MIT
            licensed. If you are moving from Sentry, see{" "}
            <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">
              migrate from Sentry
            </Link>
            .
          </li>
        </ul>

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
          <Link href="/docs/self-hosting" className="text-brand hover:underline">
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

        <h2>FAQ</h2>
        {FAQ.map((item) => (
          <div key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </div>
        ))}

        <GuideCta
          heading="Prefer not to operate Postgres?"
          body="The hosted free plan uses the same SDKs. Register, copy a key, and send the first error without standing up the API."
        />
        <GuideRelatedLinks
          links={[
            {
              href: "/docs/self-hosting",
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
