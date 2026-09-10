import Link from "next/link";
import {
  DocsCodeBlock,
  DocsDefinitions,
  DocsInlineCode,
  DocsSection,
  DocsStep,
  DocsSteps,
} from "./DocsPrimitives";

export function DocsHomePage() {
  return (
    <article className="min-w-0 pb-24">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Documentation</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        Build reliable software with confidence.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
        Telemetry Tracker is a lightweight, self-hostable pipeline for errors, events, and sessions.
        Install an SDK, point it at your ingest URL, and start triaging issues from the dashboard.
        New to the official cloud? Start with{" "}
        <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
          Hosted cloud getting started
        </Link>
        . Framework setup without the full docs sidebar:{" "}
        <Link href="/error-tracking/nextjs" className="text-brand hover:underline">
          Next.js
        </Link>
        ,{" "}
        <Link href="/error-tracking/react" className="text-brand hover:underline">
          React
        </Link>
        ,{" "}
        <Link href="/error-tracking/nodejs" className="text-brand hover:underline">
          Node.js
        </Link>
        ,{" "}
        <Link href="/error-tracking/react-native" className="text-brand hover:underline">
          React Native
        </Link>
        . Comparing to a larger platform?{" "}
        <Link href="/sentry-alternative" className="text-brand hover:underline">
          Sentry alternative
        </Link>
        .
      </p>

      <DocsSection id="introduction" title="Introduction" eyebrow="01">
        <p>
          Telemetry Tracker brings three signals you actually act on — exceptions, structured product
          events, and session boundaries — into one store you can filter by app, time, and identity
          in the dashboard.
        </p>
        <p>
          SDKs are small wrappers around <DocsInlineCode>@telemetry-tracker/core</DocsInlineCode> that
          handle init, batching, and HTTP ingest. You can self-host the API and dashboard or use a
          hosted deployment with orgs, projects, and API keys.
        </p>
      </DocsSection>

      <DocsSection id="quickstart" title="Quickstart" eyebrow="02">
        <p>
          Install the core package (or a platform wrapper), initialize with your ingest URL and API
          key, and events will appear in the dashboard within seconds.
        </p>

        <DocsSteps>
          <DocsStep n={1} title="Install the SDK">
            <DocsCodeBlock language="bash">npm install @telemetry-tracker/core</DocsCodeBlock>
          </DocsStep>
          <DocsStep n={2} title="Initialize at app entry">
            <DocsCodeBlock language="ts">{`import { init } from "@telemetry-tracker/core";

init({
  ingestUrl: "https://your-api.example.com",
  app: "my-app",
  apiKey: "tt_live_<publicId>_<secret>",
  environment: "production",
  release: "web@1.4.0",
});`}</DocsCodeBlock>
          </DocsStep>
          <DocsStep n={3} title="Capture your first event">
            <DocsCodeBlock language="ts">{`import { trackEvent } from "@telemetry-tracker/core";

trackEvent("checkout.completed", {
  plan: "pro",
  amount_usd: 29,
});`}</DocsCodeBlock>
          </DocsStep>
        </DocsSteps>
      </DocsSection>

      <DocsSection id="concepts" title="Core concepts" eyebrow="03">
        <DocsDefinitions
          items={[
            {
              term: "Organization & project",
              def: "Multi-tenant containers in the dashboard. Each project has its own API keys, usage meter, and data isolation. Pass an app string at SDK init to group telemetry in filters.",
            },
            {
              term: "Event",
              def: "A named action with optional properties, sent via trackEvent or platform helpers like screen().",
            },
            {
              term: "Error group",
              def: "Fingerprinted exceptions deduplicated server-side. Each group tracks first/last seen and occurrence count.",
            },
            {
              term: "Session",
              def: "Session start and end markers with duration. Useful for correlating errors and events to user visits.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="projects" title="Projects & API keys" eyebrow="04">
        <p>
          Create an organization and project in the dashboard, then generate an API key. Pass{" "}
          <DocsInlineCode>ingestUrl</DocsInlineCode> (your API base URL),{" "}
          <DocsInlineCode>app</DocsInlineCode> (logical app name), and{" "}
          <DocsInlineCode>apiKey</DocsInlineCode> to <DocsInlineCode>init()</DocsInlineCode>.
        </p>
        <p>
          Optional fields like <DocsInlineCode>environment</DocsInlineCode> and{" "}
          <DocsInlineCode>release</DocsInlineCode> are sent with every payload and appear in filters
          and error context. See{" "}
          <Link href="/docs/dashboard" className="text-brand hover:underline">
            Using the dashboard
          </Link>{" "}
          for org setup and key rotation.
        </p>
      </DocsSection>

      <DocsSection id="errors" title="Error tracking" eyebrow="05">
        <p>
          Uncaught exceptions and unhandled promise rejections are captured automatically in browser
          SDKs after <DocsInlineCode>init()</DocsInlineCode>. Call{" "}
          <DocsInlineCode>trackError(error, context?)</DocsInlineCode> for handled errors. The API
          fingerprints stack traces, groups them into issues, and stores individual occurrences
          with context.
        </p>
        <DocsCodeBlock language="ts">{`import { trackError } from "@telemetry-tracker/core";

try {
  await chargeCard();
} catch (err) {
  trackError(err, { page: "/checkout", step: "payment" });
  throw err;
}`}</DocsCodeBlock>
      </DocsSection>

      <DocsSection id="events" title="Event tracking" eyebrow="06">
        <p>
          Use <DocsInlineCode>trackEvent(name, properties?)</DocsInlineCode> for product analytics.
          Platform packages add helpers — for example{" "}
          <DocsInlineCode>screen(pathname)</DocsInlineCode> for page views and{" "}
          <DocsInlineCode>identify(userId)</DocsInlineCode> to attach a stable user id while
          keeping the anonymous device id for pre-login activity.
        </p>
        <DocsCodeBlock language="ts">{`import { trackEvent, screen, identify } from "@telemetry-tracker/core";

identify("user-123");
screen("/settings");
trackEvent("plan.upgraded", { from: "free", to: "pro" });`}</DocsCodeBlock>
      </DocsSection>

      <DocsSection id="sessions" title="Sessions" eyebrow="07">
        <p>
          Sessions mark the start and end of a user visit. The SDK sends session boundaries
          automatically; the dashboard shows duration and lets you filter errors and events by
          session.           For platform-specific setup (page tracking, app lifecycle), see the{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            Next.js
          </Link>
          ,{" "}
          <Link href="/docs/vue" className="text-brand hover:underline">
            Vue
          </Link>
          ,{" "}
          <Link href="/docs/nuxt" className="text-brand hover:underline">
            Nuxt
          </Link>
          ,{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS
          </Link>
          ,{" "}
          <Link href="/docs/react-native" className="text-brand hover:underline">
            React Native
          </Link>
          . See{" "}
          <Link href="/docs/releases" className="text-brand hover:underline">
            Release notes
          </Link>{" "}
          for platform version history.
        </p>
      </DocsSection>

      <DocsSection id="ingest" title="Ingest API" eyebrow="08">
        <p>
          SDKs POST JSON to the API under <DocsInlineCode>/ingest/*</DocsInlineCode>. You can also
          send payloads directly with your project API key:
        </p>
        <DocsCodeBlock language="bash">{`curl -X POST https://your-api.example.com/ingest/event \\
  -H "Authorization: Bearer tt_live_<publicId>_<secret>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "app": "my-app",
    "name": "checkout.completed",
    "properties": { "plan": "pro" }
  }'`}</DocsCodeBlock>
        <p>
          Endpoints: <DocsInlineCode>POST /ingest/event</DocsInlineCode>,{" "}
          <DocsInlineCode>POST /ingest/error</DocsInlineCode>,{" "}
          <DocsInlineCode>POST /ingest/session</DocsInlineCode>, and{" "}
          <DocsInlineCode>POST /ingest/batch</DocsInlineCode> for batched payloads. Each accepted
          request counts toward your plan&apos;s monthly ingest units.
        </p>
      </DocsSection>

      <DocsSection id="self-hosting" title="Self-hosting" eyebrow="09">
        <p>
          The monorepo includes a Fastify API (<DocsInlineCode>apps/api</DocsInlineCode>) and Next.js
          dashboard (<DocsInlineCode>apps/dashboard</DocsInlineCode>). Run both locally or deploy
          with Docker — see the repository README and DEPLOYMENT.md for environment variables,
          database setup, and optional Stripe billing. Upgrade paths by version:{" "}
          <Link href="/docs/releases" className="text-brand hover:underline">
            Release notes
          </Link>
          . Narrative overview:{" "}
          <Link href="/self-hosted-error-tracking" className="text-brand hover:underline">
            Self-hosted error tracking
          </Link>
          .
        </p>
        <p>
          Platform guides:{" "}
          <Link href="/docs/sdk" className="text-brand hover:underline">
            SDK reference
          </Link>
          ,{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            Next.js
          </Link>
          ,{" "}
          <Link href="/docs/node" className="text-brand hover:underline">
            Node.js
          </Link>
          ,{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS
          </Link>
          ,{" "}
          <Link href="/docs/nuxt" className="text-brand hover:underline">
            Nuxt
          </Link>
          ,{" "}
          <Link href="/docs/vue" className="text-brand hover:underline">
            Vue
          </Link>
          ,{" "}
          <Link href="/docs/react-native" className="text-brand hover:underline">
            React Native
          </Link>
          .
        </p>
      </DocsSection>

      <div className="mt-20 flex flex-col gap-4 rounded-2xl border border-border bg-surface/40 p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h3 className="text-base font-medium tracking-tight">Need a hand?</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Open an issue on GitHub or check the architecture docs in the repository.
          </p>
        </div>
        <a
          href="https://github.com/Telemetry-Tracker/telemetry-tracker/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] sm:self-auto"
        >
          GitHub issues
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </a>
      </div>
    </article>
  );
}
