import type { Metadata } from "next";
import Link from "next/link";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
import { DocsCodeBlock } from "@/app/components/docs/DocsCodeBlock";
import { HOSTED_API_URL, HOSTED_DASHBOARD_URL } from "@/lib/hosted-cloud";

export const metadata: Metadata = {
  title: "Hosted cloud",
  description:
    "Get started on the official Telemetry Tracker cloud at telemetry-tracker.com: register, create a project, install an SDK, and send your first event.",
  alternates: { canonical: "./" },
  openGraph: {
    title: "Hosted cloud — Telemetry Tracker",
    description:
      "Step-by-step guide for the official hosted cloud at telemetry-tracker.com.",
  },
};

export default function DocsHostedCloudPage() {
  return (
    <DocsArticle
      title="Hosted cloud getting started"
      lede={
        <p>
          Use the official managed service at{" "}
          <a href={HOSTED_DASHBOARD_URL} className="text-brand hover:underline">
            telemetry-tracker.com
          </a>{" "}
          — no infrastructure to run. Create an account, wire an SDK to{" "}
          <code className="text-foreground">{HOSTED_API_URL}</code>, and triage errors from the
          dashboard in minutes.
        </p>
      }
    >
      <section className="mb-10" aria-labelledby="hosted-prereq-heading">
        <h2 id="hosted-prereq-heading">Before you start</h2>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          <li>
            A browser and an app you can instrument (web, Node, NestJS, or React Native — see{" "}
            <Link href="/docs/sdk" className="text-brand hover:underline">
              SDK guides
            </Link>
            ).
          </li>
          <li>
            The hosted <strong className="text-foreground">ingest URL</strong>:{" "}
            <code className="text-foreground">{HOSTED_API_URL}</code>
          </li>
          <li>
            A project <strong className="text-foreground">API key</strong> (
            <code className="text-foreground">tt_live_…</code>) from the dashboard — shown once at
            creation.
          </li>
        </ul>
      </section>

      <section className="mb-10" aria-labelledby="hosted-account-heading">
        <h2 id="hosted-account-heading">1. Create your account</h2>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Open{" "}
            <a href={`${HOSTED_DASHBOARD_URL}/register`} className="text-brand hover:underline">
              {HOSTED_DASHBOARD_URL}/register
            </a>{" "}
            and sign up with email and password.
          </li>
          <li>
            On first login, create an <strong className="text-foreground">organization</strong>{" "}
            (your team or company name).
          </li>
          <li>
            Create a <strong className="text-foreground">project</strong> under Organization
            settings — each project has isolated API keys and usage meters.
          </li>
        </ol>
      </section>

      <section className="mb-10" aria-labelledby="hosted-key-heading">
        <h2 id="hosted-key-heading">2. Generate an API key</h2>
        <p>
          Go to <strong className="text-foreground">Settings → API keys</strong> and create a key
          for your project. Copy the secret immediately — it is not shown again. Store it in your
          deployment secrets (for example{" "}
          <code className="text-foreground">TELEMETRY_API_KEY</code> or{" "}
          <code className="text-foreground">NEXT_PUBLIC_TELEMETRY_API_KEY</code> for client-side
          Next.js apps).
        </p>
      </section>

      <section className="mb-10" aria-labelledby="hosted-sdk-heading">
        <h2 id="hosted-sdk-heading">3. Install and initialize the SDK</h2>
        <p>
          Install a package for your stack (all packages live under{" "}
          <code className="text-foreground">@telemetry-tracker/*</code> on npm):
        </p>
        <DocsCodeBlock language="bash">pnpm add @telemetry-tracker/core</DocsCodeBlock>
        <p className="mt-4">
          Initialize at app entry with the hosted ingest URL, your logical app name, and the API
          key:
        </p>
        <DocsCodeBlock language="ts">{`import { init, trackEvent } from "@telemetry-tracker/core";

init({
  ingestUrl: "${HOSTED_API_URL}",
  app: "my-web-app",
  apiKey: process.env.TELEMETRY_API_KEY!,
  environment: "production",
  release: "1.0.0",
});

trackEvent("app.started");`}</DocsCodeBlock>
        <p className="mt-4">
          For Next.js, use{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            @telemetry-tracker/next
          </Link>{" "}
          with <code className="text-foreground">NEXT_PUBLIC_TELEMETRY_INGEST_URL</code> set to{" "}
          <code className="text-foreground">{HOSTED_API_URL}</code>. For Vue, Nuxt, or NestJS see{" "}
          <Link href="/docs/vue" className="text-brand hover:underline">
            Vue
          </Link>
          ,{" "}
          <Link href="/docs/nuxt" className="text-brand hover:underline">
            Nuxt
          </Link>
          , and{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS
          </Link>{" "}
          guides.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="hosted-verify-heading">
        <h2 id="hosted-verify-heading">4. Verify in the dashboard</h2>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Open{" "}
            <Link href="/dashboard/overview" className="text-brand hover:underline">
              Overview
            </Link>{" "}
            — counts should update within seconds.
          </li>
          <li>
            Check <strong className="text-foreground">Issues</strong> after triggering a test error.
          </li>
          <li>
            Optional: upload source maps under{" "}
            <strong className="text-foreground">Settings → Source maps</strong> and confirm
            symbolicated stacks on error detail (match the <code className="text-foreground">release</code>{" "}
            sent from your SDK).
          </li>
          <li>
            Optional: configure spike or quota alerts under{" "}
            <Link href="/dashboard/alerts" className="text-brand hover:underline">
              Alerts
            </Link>
            .
          </li>
        </ol>
      </section>

      <section className="mb-10" aria-labelledby="hosted-plans-heading">
        <h2 id="hosted-plans-heading">Plans & billing</h2>
        <p>
          The hosted cloud offers Free, Pro, and Business tiers (EUR via Stripe). Usage limits,
          retention windows, and source map quotas follow your organization plan — see{" "}
          <Link href="/#pricing" className="text-brand hover:underline">
            pricing
          </Link>{" "}
          and <strong className="text-foreground">Settings → Billing & usage</strong> in the
          dashboard.
        </p>
      </section>

      <section aria-labelledby="hosted-self-host-heading">
        <h2 id="hosted-self-host-heading">Self-hosting instead?</h2>
        <p>
          The same SDKs and dashboard run on your infrastructure. See{" "}
          <Link href="/docs#self-hosting" className="text-brand hover:underline">
            Self-hosting
          </Link>{" "}
          and the repository{" "}
          <a
            href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/DEPLOYMENT.md"
            className="text-brand hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            DEPLOYMENT.md
          </a>
          .
        </p>
      </section>

      <DocsAlsoSee
        links={[
          { href: "/sentry-alternative", label: "Sentry alternative" },
          { href: "/self-hosted-error-tracking", label: "Self-hosted error tracking" },
          { href: "/error-tracking/nextjs", label: "Next.js error tracking" },
        ]}
      />
    </DocsArticle>
  );
}
