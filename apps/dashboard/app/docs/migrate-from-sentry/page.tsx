import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
import {
  nextEnvLocal,
  nextEnvLocalServer,
  nextInstall,
  nextInstrumentation,
  nextProviderSetup,
  nextTrackPageView,
} from "@/lib/sdk-setup-snippets";

export const metadata: Metadata = {
  title: "Migrate from Sentry",
  description:
    "Sentry migration guide: replace the Sentry SDK with Telemetry Tracker, including Next.js App Router setup, source maps, and what does not migrate.",
  alternates: { canonical: "./" },
};

const sentryCalls = `import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
  environment: "production",
  release: "web@1.4.0",
});

Sentry.captureException(error);
Sentry.setUser({ id: user.id, email: user.email, username: user.username });
Sentry.captureMessage("checkout started");
Sentry.setTag("plan", "pro");
Sentry.setContext("order", { id: orderId });`;

const telemetryCalls = `import { init, identify, trackError, trackEvent } from "@telemetry-tracker/core";

init({
  ingestUrl: "https://api.telemetry-tracker.com",
  apiKey: "tt_live_<publicId>_<secret>",
  app: "my-app",
  environment: "production",
  release: "web@1.4.0",
});

trackError(error, { plan: "pro", orderId });
identify(user.id, { email: user.email });
trackEvent("checkout_started", { plan: "pro", orderId });`;

export default function DocsMigrateFromSentryPage() {
  return (
    <DocsArticle
      title="Migrate from Sentry"
      lede={
        <p>
          Migration means removing the Sentry SDK and calling Telemetry Tracker. Changing a DSN is
          not enough. This page maps the calls. For how the products differ, see{" "}
          <Link href="/sentry-alternative" className="text-brand hover:underline">
            Sentry alternative
          </Link>
          .
        </p>
      }
    >
      <h2>What changes</h2>
      <ul>
        <li>
          <code>Sentry.init</code> → <code>init</code> on{" "}
          <code>@telemetry-tracker/core</code>, or <code>TelemetryProvider</code> in Next.js. Required
          fields are <code>ingestUrl</code>, <code>app</code>, and <code>apiKey</code>.{" "}
          <code>environment</code> and <code>release</code> are optional and are sent with each
          payload.
        </li>
        <li>
          <code>captureException</code> → <code>trackError(error, context?)</code>. Context is
          per call.
        </li>
        <li>
          <code>setUser</code> → <code>identify(id, traits?)</code>. <code>traits</code> accepts{" "}
          <code>email</code> only. <code>identify(null)</code> clears the user id. Other{" "}
          <code>setUser</code> fields, including <code>username</code>, are not stored.
        </li>
        <li>
          <code>captureMessage</code> → <code>trackEvent(name, properties?)</code> when the message
          is a product event. <code>trackEvent</code> does not open an error group. To group a
          handled failure, call <code>trackError(new Error(message), context?)</code>.
        </li>
        <li>
          Global tags and context → properties on <code>trackEvent</code> and <code>context</code>{" "}
          on <code>trackError</code>. There is no <code>setTag</code> or <code>setContext</code>.
        </li>
        <li>
          <code>@sentry/nextjs</code> → <code>@telemetry-tracker/next</code>,{" "}
          <code>TelemetryProvider</code>, and <code>createOnRequestError</code> for App Router
          server capture.
        </li>
      </ul>
      <CodeBlock code={sentryCalls} lang="ts" caption="Sentry calls this guide replaces" />
      <CodeBlock code={telemetryCalls} lang="ts" caption="@telemetry-tracker/core" />

      <h2>Next.js</h2>
      <p>
        Remove <code>@sentry/nextjs</code>, <code>withSentryConfig</code>, and{" "}
        <code>Sentry.init</code> from the client, server, and edge entrypoints. Remove{" "}
        <code>Sentry.captureRequestError</code> if <code>instrumentation.ts</code> exports it as{" "}
        <code>onRequestError</code>.
      </p>
      <p>
        The blocks below are the same snippets as{" "}
        <Link href="/docs/nextjs" className="text-brand hover:underline">
          Next.js
        </Link>
        . Browser setup uses <code>NEXT_PUBLIC_TELEMETRY_INGEST_URL</code>,{" "}
        <code>NEXT_PUBLIC_TELEMETRY_API_KEY</code>, and <code>NEXT_PUBLIC_TELEMETRY_APP</code>.
        Server capture uses <code>TELEMETRY_INGEST_URL</code>, <code>TELEMETRY_API_KEY</code>, and{" "}
        <code>TELEMETRY_APP</code> with no <code>NEXT_PUBLIC_</code> prefix.
      </p>
      <CodeBlock code={nextInstall} lang="bash" caption="Install" />
      <CodeBlock code={nextEnvLocal} lang="bash" caption=".env.local (browser)" />
      <CodeBlock code={nextProviderSetup} lang="tsx" caption="app/layout.tsx" />
      <CodeBlock code={nextTrackPageView} lang="tsx" caption="app/track-page-view.tsx" />
      <p>
        <code>createOnRequestError</code> from <code>@telemetry-tracker/next/server</code> reports
        uncaught App Router errors in Server Components, Route Handlers, and Server Actions. It does
        not report errors you catch, browser errors, or build failures. Skip it for a browser-only
        app.
      </p>
      <CodeBlock code={nextEnvLocalServer} lang="bash" caption=".env.local (server)" />
      <CodeBlock code={nextInstrumentation} lang="ts" caption="instrumentation.ts" />

      <h2>Source maps</h2>
      <p>
        Telemetry Tracker does not upload source maps from <code>withSentryConfig</code>. Upload
        maps yourself for the same <code>release</code> string the SDK sends. Symbolication changes
        how a stack is displayed. Grouping still uses the minified stack. Each map is one JSON file
        per app, release, and bundle URL, and <code>bundle_url</code> must match the script URL
        that was loaded.
      </p>
      <p>
        Next.js output, the GitHub Action, and the <code>sourceMappingURL</code> rules are
        documented on{" "}
        <Link href="/docs/source-maps" className="text-brand hover:underline">
          Source maps
        </Link>
        .
      </p>

      <h2>What does not migrate</h2>
      <p>Telemetry Tracker currently has no equivalent for:</p>
      <ul>
        <li>Sentry historical issues, events, or attachments. There is no import.</li>
        <li>Breadcrumbs.</li>
        <li>Distributed tracing and spans.</li>
        <li>Session replay. Sessions here are start and end markers, not recordings.</li>
        <li>
          Global tags and context. <code>environment</code> and <code>release</code> on{" "}
          <code>init</code> apply to later payloads. Arbitrary tags must be passed on each{" "}
          <code>trackEvent</code> or <code>trackError</code> call.
        </li>
        <li>
          Sentry’s framework and language coverage. Current packages are core, Next.js, Node.js,
          and React Native, plus Vue, Nuxt, and NestJS guides that use those packages. There is no
          Python, Go, PHP, Ruby, or native iOS/Android SDK.
        </li>
      </ul>

      <h2>Why a separate SDK?</h2>
      <p>
        Telemetry Tracker stores errors, events, and sessions through its own JSON ingest API (
        <code>/ingest/error</code>, <code>/ingest/event</code>, <code>/ingest/batch</code>,{" "}
        <code>/ingest/session</code>). It does not accept Sentry’s envelope protocol, so a Sentry
        SDK cannot target a Telemetry Tracker key.
      </p>

      <DocsAlsoSee
        links={[
          { href: "/sentry-alternative", label: "Sentry alternative" },
          { href: "/docs/nextjs", label: "Next.js" },
          { href: "/docs/source-maps", label: "Source maps" },
        ]}
      />
    </DocsArticle>
  );
}
