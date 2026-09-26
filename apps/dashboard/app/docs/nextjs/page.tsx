import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
import { HOSTED_API_URL } from "@/lib/hosted-cloud";
import {
  nextDocsCheckButton,
  nextDocsCheckPage,
  nextEnvLocal,
  nextEnvLocalServer,
  nextErrorBoundary,
  nextInstall,
  nextInstrumentation,
  nextProviderSetup,
  nextTrackPageView,
} from "@/lib/sdk-setup-snippets";

export const metadata: Metadata = {
  title: "Next.js",
  description: "Integrate Telemetry Tracker with Next.js",
  alternates: { canonical: "./" },
};

export default function DocsNextJsPage() {
  return (
    <DocsArticle
      title="Next.js"
      lede={
        <p>
          Use <code>@telemetry-tracker/next</code> for App Router apps. The package provides a
          provider, error boundary, page-view hook, and (from 1.3.2) an optional server entry for{" "}
          <code>instrumentation.ts</code>. After <code>init()</code>, uncaught browser errors and
          unhandled promise rejections are reported automatically.
        </p>
      }
    >
      <h2>Install</h2>
      <CodeBlock code={nextInstall} lang="bash" />

      <h2>API key and ingest URL</h2>
      <p>
        Hosted ingest is <code>{HOSTED_API_URL}</code>. Create a project key under{" "}
        <strong>Settings → API keys</strong> (the secret is shown once). For browser setup, put
        these in <code>.env.local</code>:
      </p>
      <CodeBlock code={nextEnvLocal} lang="bash" caption=".env.local (browser)" />
      <p>
        <code>NEXT_PUBLIC_TELEMETRY_API_KEY</code> is intentional for client-side ingest (it is
        bundled into the browser). Without <code>apiKey</code>, hosted ingest returns{" "}
        <code>401</code>. Without <code>ingestUrl</code> pointing at the API host, the SDK posts to
        your app origin and you get <code>404</code>. See{" "}
        <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
          Hosted cloud
        </Link>{" "}
        for account and project setup.
      </p>
      <p>
        Server-only variables (no <code>NEXT_PUBLIC_</code> prefix) are needed only if you add{" "}
        <code>instrumentation.ts</code> below — skip them for browser-only setup:
      </p>
      <CodeBlock code={nextEnvLocalServer} lang="bash" caption=".env.local (optional server)" />

      <h2>Setup</h2>
      <p>
        Use a <strong>server</strong> root layout with <code>TelemetryProvider</code>, and a small{" "}
        <code>&quot;use client&quot;</code> helper for <code>usePathname()</code> /{" "}
        <code>useTrackPage</code>. Keep these two files in your app. Do not call{" "}
        <code>usePathname</code> inside the server layout.
      </p>
      <CodeBlock code={nextProviderSetup} lang="tsx" caption="app/layout.tsx" />
      <CodeBlock code={nextTrackPageView} lang="tsx" caption="app/track-page-view.tsx" />

      <h2>Verify ingest (optional)</h2>
      <p>
        Not part of production setup. Temporarily add a client button that calls{" "}
        <code>trackError(new Error(&quot;docs-check&quot;))</code>, click it, confirm{" "}
        <code>/ingest/session</code> and <code>/ingest/error</code> return <code>204</code>, then
        open <strong>Issues</strong>. Delete these files afterward.
      </p>
      <CodeBlock code={nextDocsCheckButton} lang="tsx" caption="optional verification button" />
      <CodeBlock code={nextDocsCheckPage} lang="tsx" caption="optional temporary route" />

      <h2>Server errors (optional)</h2>
      <p>
        Skip this section for browser-only setup.{" "}
        <code>@telemetry-tracker/next/server</code> (published with{" "}
        <code>@telemetry-tracker/next@1.3.2</code>) exports <code>createOnRequestError</code> for{" "}
        <code>instrumentation.ts</code>. Next.js calls it for uncaught App Router errors in Server
        Components, Route Handlers, and Server Actions. The helper uses <code>fetch</code> only (Node
        and Edge). It never throws into Next.js, does not forward request headers, strips query
        strings from the path, and skips an error already marked with the shared reported symbol (or
        a recent Next.js digest). It does not report errors you catch, browser errors, or build
        failures. Use <code>TELEMETRY_API_KEY</code> (server-only) — do not expose a server-only
        secret via <code>NEXT_PUBLIC_*</code>.
      </p>
      <CodeBlock code={nextInstrumentation} lang="ts" caption="instrumentation.ts (optional)" />

      <h2>React render errors</h2>
      <p>
        Wrap parts of your tree with <code>TelemetryErrorBoundary</code> to report React render
        errors (and optionally show a fallback):
      </p>
      <CodeBlock code={nextErrorBoundary} lang="tsx" />

      <h2>Custom events and identify</h2>
      <p>
        Import <code>trackEvent</code>, <code>screen</code>, and <code>identify</code> from{" "}
        <code>@telemetry-tracker/next</code> when needed.
      </p>
      <CodeBlock
        code={`import { trackEvent, screen, identify } from "@telemetry-tracker/next";

trackEvent("signup_clicked", { source: "hero" });
screen("/settings");
identify(user.id);  // after login
identify(null);     // on logout`}
        lang="ts"
      />

      <DocsAlsoSee
        links={[
          { href: "/error-tracking/nextjs", label: "Next.js error tracking guide" },
          { href: "/error-tracking/react", label: "React error tracking" },
          { href: "/docs/hosted-cloud", label: "Hosted cloud getting started" },
        ]}
      />
    </DocsArticle>
  );
}
