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

const PATH = "/error-tracking/nextjs/server-components-render-error";
const TITLE = "Next.js Server Components Render Error: Find the Real Error";
const H1 =
  'Next.js "An error occurred in the Server Components render": find the real error behind the digest';
const DESCRIPTION =
  "The digest hides the real Next.js server error. Find it in logs, capture it with onRequestError, and get readable server stack traces. Tested on Next 16.";

const REDACTED = `Error: An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.`;

const MINIFIED = `Minified React error #441; visit https://react.dev/errors/441?args[]=… for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`;

const ERROR_UI = `// app/error.tsx — show the reference, don't stop here
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <p>Reference: {error.digest}</p>;
}`;

const LOG_SEARCH = `# Docker
docker logs my-next-app 2>&1 | grep -B8 "digest: '2474318592'"
# Local production repro
npx next build && npx next start   # then open the failing route and read the terminal`;

const MINIFIED_STACK = `⨯ Error: Profile query failed for user 42: connect ECONNREFUSED 10.0.0.5:5432
    at c (.next/server/chunks/ssr/[root-of-the-server]__1j3ej0p._.js:1:271)
    at async d (.next/server/chunks/ssr/[root-of-the-server]__1j3ej0p._.js:1:376)
  digest: '2474318592'`;

const ENV = `# .env.local / hosting provider env (server-only)
TELEMETRY_INGEST_URL=https://api.telemetry-tracker.com
TELEMETRY_API_KEY=tt_live_<publicId>_<secret>
TELEMETRY_APP=my-next-app`;

const INSTRUMENTATION_MIN = `// instrumentation.ts
import { createOnRequestError } from "@telemetry-tracker/next/server";

export const onRequestError = createOnRequestError({
  ingestUrl: process.env.TELEMETRY_INGEST_URL ?? "https://api.telemetry-tracker.com",
  apiKey: process.env.TELEMETRY_API_KEY,
  app: process.env.TELEMETRY_APP ?? "my-next-app",
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_TT_RELEASE, // optional: same release string as the browser SDK
});`;

const ERROR_TSX = `"use client";

import { useEffect } from "react";
import { trackError, trackEvent } from "@telemetry-tracker/next";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (error.digest) {
      // Server error: onRequestError (instrumentation.ts) already reported the
      // real message and stack. Record that a user actually saw it.
      trackEvent("server_error_shown", { digest: error.digest, path: window.location.pathname });
    } else {
      // Browser-side render error: report it as an error.
      trackError(error, { boundary: "app/error.tsx" });
    }
  }, [error]);

  return (
    <div>
      <h2>Something went wrong.</h2>
      {error.digest && <p>Reference: {error.digest}</p>}
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}`;

const MAP_STACK = `// lib/map-server-stack.ts (Node.js runtime only)
// Rewrites minified ".next/server/..." stack frames to your original files,
// using the server source maps that \`next build\` writes next to its chunks.
import { findSourceMap } from "node:module";

const FRAME = /^(\\s*at (?:.+? \\()?)(\\/.+?\\.js):(\\d+):(\\d+)(\\)?)$/;

function cleanSource(source: string): string {
  const s = source
    .replace(/^turbopack:\\/\\/\\/\\[project\\]\\//, "") // Turbopack prefix
    .replace(/^webpack:\\/\\/[^/]*\\//, "") // webpack (Next.js 15, or 16 with --webpack)
    .replace(/^file:\\/\\//, "");
  const root = process.cwd() + "/";
  return s.startsWith(root) ? s.slice(root.length) : s; // show app/page.tsx, not /srv/app/app/page.tsx
}

export function mapServerStack(stack: string): string {
  return stack
    .split("\\n")
    .map((line) => {
      const m = line.match(FRAME);
      if (!m || !m[2].includes("/.next/server/")) return line;
      const [, prefix, file, ln, col, suffix] = m;
      const entry = findSourceMap(file)?.findEntry(Number(ln) - 1, Number(col) - 1);
      if (!entry || !("originalSource" in entry) || !entry.originalSource) return line;
      const source = cleanSource(entry.originalSource);
      return \`\${prefix}\${source}:\${entry.originalLine + 1}:\${entry.originalColumn + 1}\${suffix}\`;
    })
    .join("\\n");
}`;

const INSTRUMENTATION_FULL = `// instrumentation.ts
import { createOnRequestError } from "@telemetry-tracker/next/server";

export function register() {
  // Let Node.js load the .map files next to the server chunks (Node.js runtime only).
  if (process.env.NEXT_RUNTIME === "nodejs") process.setSourceMapsEnabled(true);
}

const reportToTelemetry = createOnRequestError({
  ingestUrl: process.env.TELEMETRY_INGEST_URL ?? "https://api.telemetry-tracker.com",
  apiKey: process.env.TELEMETRY_API_KEY,
  app: process.env.TELEMETRY_APP ?? "my-next-app",
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_TT_RELEASE,
});

export const onRequestError: typeof reportToTelemetry = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs" && error instanceof Error && error.stack) {
    try {
      const { mapServerStack } = await import("./lib/map-server-stack");
      error.stack = mapServerStack(error.stack);
    } catch {
      // Never let stack mapping break error reporting.
    }
  }
  await reportToTelemetry(error, request, context);
};`;

const WEBPACK_MAPS = `// next.config.ts (Next.js 15, or Next.js 16 with --webpack)
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverSourceMaps: true },
};

export default nextConfig;`;

const BEFORE_AFTER = `Before:  at c (.next/server/chunks/ssr/[root-of-the-server]__1j3ej0p._.js:1:271)
         at async d (.next/server/chunks/ssr/[root-of-the-server]__1j3ej0p._.js:1:376)
After:   at c (lib/db.ts:3:13)
         at async d (app/boom/page.tsx:4:13)`;

const DOCKER_COPY = `# after RUN npm run build, in the builder stage
RUN cd .next/server && find . -name '*.map' -exec sh -c \\
  'mkdir -p "../standalone/.next/server/$(dirname "$1")" && cp "$1" "../standalone/.next/server/$1"' _ {} \\;`;

const START_FLAG = `"start": "NODE_OPTIONS=--enable-source-maps next start"`;

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function ServerComponentsRenderErrorPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({ origin, path: PATH, name: H1, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "Next.js error tracking", path: "/error-tracking/nextjs" },
            { name: "Server Components render error", path: PATH },
          ]),
          howToJsonLd({
            name: "Find the real error behind a Next.js Server Components digest",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Grab the digest",
                text: "Read error.digest from error.tsx or the production error text.",
              },
              {
                name: "Find it in server logs",
                text: "Search server logs for the digest, or reproduce with next build && next start.",
              },
              {
                name: "Capture server errors with onRequestError",
                text: "Export onRequestError from instrumentation.ts (Next.js 15+) so the real message is recorded on the server.",
              },
              {
                name: "Make server stacks readable",
                text: "Apply the server source maps next build already writes, including a copy step for output: standalone.",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title={H1}
        updated="2026-10"
        lede={
          <p>
            A production App Router page can show only a digest. The real message stayed on the
            server. This page is how to read that digest, get the message and line, and stop the
            next one arriving as a screenshot. Setup for the browser SDK is on the{" "}
            <Link href="/error-tracking/nextjs" className="text-brand hover:underline">
              Next.js error tracking guide
            </Link>
            .
          </p>
        }
      >
        <CodeBlock code={REDACTED} lang="text" caption="Production Server Components error" />
        <p>
          On Next.js 16 / React 19.3 the browser usually gets the minified form instead. Same
          error.{" "}
          <a href="https://react.dev/errors/441" className="text-brand hover:underline">
            react.dev/errors/441
          </a>{" "}
          decodes it to the sentence above.
        </p>
        <CodeBlock code={MINIFIED} lang="text" caption="Minified React error #441" />
        <p>
          Next.js hid the real error on purpose. The digest is the key that matches the browser to
          the server log. The rest of this page is how to get the real message and the file and
          line that threw it.
        </p>
        <aside className="not-prose rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm leading-relaxed">
          <p className="font-medium text-foreground">TL;DR</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Grab the digest.</li>
            <li>
              Find it in server logs, or reproduce with <code>next build &amp;&amp; next start</code>
              .
            </li>
            <li>
              Capture server errors automatically with <code>onRequestError</code> (Next.js 15+).
            </li>
            <li>Make server stacks readable.</li>
          </ol>
        </aside>

        <h2>What this error actually means</h2>
        <p>
          Next.js redacts server error messages in production so secrets, SQL, and paths do not
          reach the browser. The browser gets a generic message plus <code>digest</code>. The full
          error is logged on the server with the same digest.
        </p>
        <p>
          You see it in <code>error.tsx</code>, <code>global-error.tsx</code>, and on a rejected
          Server Action promise. <code>next dev</code> shows the real message, which is why it only
          shows up once you run a production build.
        </p>
        <aside className="not-prose rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm leading-relaxed">
          Route Handlers (<code>route.ts</code>) do not use this redaction. The client gets a 500
          and no digest.
        </aside>

        <h2>Step 1: Get the digest and find it in your server logs</h2>
        <p>
          Show the digest in the error UI so a user can send it with the screenshot.{" "}
          <code>error.digest</code> is the value you search for.
        </p>
        <CodeBlock code={ERROR_UI} lang="tsx" caption="app/error.tsx" />
        <p>
          Search that value in server logs. On Vercel, open Logs and search the digest. On Docker
          or a VM, grep the container or the process log. Next prints{" "}
          <code>⨯ Error: &lt;real message&gt; … {"{ digest: '…' }"}</code>.
        </p>
        <CodeBlock code={LOG_SEARCH} lang="bash" caption="Find a digest in logs" />
        <p>
          The fast local repro is a production build, not <code>next dev</code>:{" "}
          <code>npx next build &amp;&amp; npx next start</code>, then open the failing route and
          read the terminal.
        </p>
        <p>
          Older Next.js versions did not log digests for Server Actions or client navigations (
          <a
            href="https://github.com/vercel/next.js/issues/60684"
            className="text-brand hover:underline"
          >
            #60684
          </a>
          ,{" "}
          <a
            href="https://github.com/vercel/next.js/issues/63304"
            className="text-brand hover:underline"
          >
            #63304
          </a>
          ). On 16.3.8 those digests are logged.
        </p>
        <p>
          The stack in that log is often minified. If it points into{" "}
          <code>.next/server/chunks/…</code>, keep reading. Step 4 fixes that.
        </p>
        <CodeBlock code={MINIFIED_STACK} lang="text" caption="Minified server log" />

        <h2>Is your digest a number or a word?</h2>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Digest</th>
                <th className="px-4 py-3 font-medium">What it is</th>
                <th className="px-4 py-3 font-medium">What to do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 align-top font-mono text-xs">2474318592</td>
                <td className="px-4 py-3 align-top">A hash of a real thrown error.</td>
                <td className="px-4 py-3 align-top">Find that hash in the server log.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top font-mono text-xs">DYNAMIC_SERVER_USAGE</td>
                <td className="px-4 py-3 align-top">
                  A Next.js error code. Calling <code>cookies</code>, <code>headers</code>, or
                  reading <code>searchParams</code> on a route Next tried to render statically.
                </td>
                <td className="px-4 py-3 align-top">
                  Render that route dynamically. See{" "}
                  <a
                    href="https://nextjs.org/docs/messages/dynamic-server-error"
                    className="text-brand hover:underline"
                  >
                    dynamic-server-error
                  </a>
                  . Next treats this as a known internal error and does not pass it to{" "}
                  <code>onRequestError</code> (<code>getDigestForWellKnownError</code> in{" "}
                  <code>create-error-handler</code>), so it will not show up as a server issue.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top font-mono text-xs">any other word</td>
                <td className="px-4 py-3 align-top">
                  Your code, or a library, set <code>error.digest</code> itself.
                </td>
                <td className="px-4 py-3 align-top">Search for that string in your app and dependencies.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>The usual suspects</h2>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Cause</th>
                <th className="px-4 py-3 font-medium">Real server message</th>
                <th className="px-4 py-3 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 align-top">
                  <code>await res.json()</code> on an HTML or error response
                </td>
                <td className="px-4 py-3 align-top">
                  <code>SyntaxError: Unexpected token &apos;&lt;&apos;, &quot;&lt;html&gt;…&quot; is not valid JSON</code>
                </td>
                <td className="px-4 py-3 align-top">
                  Check <code>res.ok</code> and the content type before parsing.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">
                  A function or class instance passed to a Client Component
                </td>
                <td className="px-4 py-3 align-top">
                  <code>Event handlers cannot be passed to Client Component props.</code> Digest{" "}
                  <code>3879515415</code> in one reproduction.
                </td>
                <td className="px-4 py-3 align-top">
                  Pass plain data. Move the handler into the Client Component.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">A failing upstream or auth call</td>
                <td className="px-4 py-3 align-top">
                  For example <code>Server response error: 401</code>
                </td>
                <td className="px-4 py-3 align-top">
                  Handle the expected failure and return a value instead of throwing.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">
                  Expected Server Action failures thrown as errors
                </td>
                <td className="px-4 py-3 align-top">Whatever message you threw</td>
                <td className="px-4 py-3 align-top">
                  Return <code>{"{ error }"}</code> and show it with <code>useActionState</code>. See
                  the{" "}
                  <a
                    href="https://nextjs.org/docs/app/getting-started/error-handling"
                    className="text-brand hover:underline"
                  >
                    Next.js error-handling docs
                  </a>
                  .
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">
                  Browser-only code (<code>window</code>, <code>document</code>) imported into server
                  code
                </td>
                <td className="px-4 py-3 align-top">
                  <code>window is not defined</code> or <code>document is not defined</code>
                </td>
                <td className="px-4 py-3 align-top">
                  Move it behind <code>&quot;use client&quot;</code> or{" "}
                  <code>dynamic(…, {"{ ssr: false }"})</code>.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Missing server env vars or secrets</td>
                <td className="px-4 py-3 align-top">The message usually names the undefined value.</td>
                <td className="px-4 py-3 align-top">
                  Set the variable in the production environment. This one shows up in reports; it
                  was not reproduced for this page.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Step 2: Capture the real error automatically with onRequestError</h2>
        <p>
          Next.js 15+ can export <code>onRequestError</code> from <code>instrumentation.ts</code>{" "}
          (project root, or <code>src/</code> if you use it). It runs on the server for uncaught
          errors in Server Components, Server Actions, and Route Handlers. It receives the error,
          the request (path, method, headers), and context (<code>routePath</code>,{" "}
          <code>routeType</code>, <code>renderSource</code>). Await the send. Do not forward
          headers: they include cookies and authorization.
        </p>
        <p>
          Sentry&apos;s Next.js SDK hooks the same <code>onRequestError</code>. If you are
          migrating, see{" "}
          <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">
            Migrate from Sentry
          </Link>
          .
        </p>
        <h3>With Telemetry Tracker</h3>
        <p>
          Create a project and an API key in{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            hosted cloud
          </Link>{" "}
          (or point <code>TELEMETRY_INGEST_URL</code> at a{" "}
          <Link href="/docs/self-hosting" className="text-brand hover:underline">
            self-hosted
          </Link>{" "}
          API). Set the server variables in the production environment. They are not{" "}
          <code>NEXT_PUBLIC_</code>. The SDK reference is{" "}
          <Link href="/docs/nextjs" className="text-brand hover:underline">
            /docs/nextjs
          </Link>
          . <code>release</code> is optional: any build id, such as the git SHA.{" "}
          <code>NEXT_PUBLIC_TT_RELEASE</code> is one name for sharing that string with the browser
          SDK.
        </p>
        <CodeBlock code={ENV} lang="bash" caption=".env.local (server-only)" />
        <CodeBlock code={INSTRUMENTATION_MIN} lang="ts" caption="instrumentation.ts" />
        <p>
          The hook is a plain <code>fetch</code>. It never throws into Next.js. It drops request
          headers and the query string. The same Error object is reported once. A second callback
          in the same turn with the same digest is skipped. A later request that throws again is
          reported again, and the dashboard counts another occurrence of that issue. Global search
          and the Issues search match <code>context.digest</code>, so you can paste the reference
          from the screenshot.
        </p>
        <p>What you get on the issue:</p>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium">Example</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 font-mono text-xs">message</td>
                <td className="px-4 py-3">
                  Profile query failed for user 42: connect ECONNREFUSED 10.0.0.5:5432
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs">context.routeType</td>
                <td className="px-4 py-3">
                  <code>render</code> / <code>action</code> / <code>route</code>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs">context.routePath</td>
                <td className="px-4 py-3">
                  <code>/boom</code>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs">context.renderSource</td>
                <td className="px-4 py-3">
                  <code>react-server-components</code> (full load) /{" "}
                  <code>react-server-components-payload</code> (navigation, action)
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs">context.digest</td>
                <td className="px-4 py-3">
                  <code>2474318592</code> (same as the user&apos;s Reference). Route Handlers have
                  no digest.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs">context.path</td>
                <td className="px-4 py-3">
                  <code>/boom</code> (query string stripped)
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-xs">release / environment</td>
                <td className="px-4 py-3">
                  <code>r1</code> / <code>production</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <figure className="not-prose my-6 overflow-hidden rounded-xl border border-dashed border-border bg-surface/40">
          <div
            role="img"
            aria-label="Error detail page Context panel showing routeType, routePath, path, digest, and runtime for a Server Components render error."
            className="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            Screenshot of the error detail Context panel. It will be added after a hosted example is
            captured.
          </div>
        </figure>
        <aside className="not-prose rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm leading-relaxed">
          The digest in the user&apos;s screenshot matches <code>context.digest</code> on the server
          issue, for full page loads, client-side navigations, and Server Actions. Checked on Next.js
          16.3.8.
        </aside>

        <h2>Step 3: Make error.tsx report the right thing</h2>
        <p>
          In production the browser gets <code>Minified React error #441</code> with no stack.
          Reporting that with <code>trackError</code> creates one stackless issue for every server
          error. If <code>error.digest</code> is set, the server hook already reported the real
          error. Record a <code>server_error_shown</code> event (digest and path) instead. If there
          is no digest, it is a browser render error: call <code>trackError</code>. Still show{" "}
          <code>Reference: {"{digest}"}</code> to the user.
        </p>
        <p>
          This replaces a <code>trackError(error, {"{ digest }"})</code> call for errors that carry
          a digest. Next.js 16 also passes <code>retry</code>; the sample keeps <code>reset</code>{" "}
          so it still typechecks on Next.js 15.
        </p>
        <CodeBlock code={ERROR_TSX} lang="tsx" caption="app/error.tsx" />
        <p>
          <code>global-error.tsx</code> follows the same split, and it must render its own{" "}
          <code>&lt;html&gt;</code> and <code>&lt;body&gt;</code>. If the root layout itself failed,
          the client SDK may never have initialized. The server report from{" "}
          <code>onRequestError</code> still arrives.
        </p>

        <h2>Step 4: Readable server stack traces (no uploads, no tracing)</h2>
        <p>
          <code>next build</code> already writes source maps for server chunks. Turbopack writes
          them by default. Webpack (Next.js 15, or Next.js 16 with <code>--webpack</code>) writes
          none until <code>experimental.serverSourceMaps</code> is on. Node can read those files.
          Apply them to <code>error.stack</code> before it is sent. Browser source-map upload is a
          different problem; see{" "}
          <Link href="/docs/source-maps" className="text-brand hover:underline">
            source maps
          </Link>{" "}
          for browser bundles.
        </p>
        <p>
          The helper is plain Node. It runs before any reporter, so the rewritten stack is what
          gets sent if you report the error somewhere else.
        </p>
        <CodeBlock code={BEFORE_AFTER} lang="text" caption="Before and after" />
        <CodeBlock code={MAP_STACK} lang="ts" caption="lib/map-server-stack.ts" />
        <p>
          It handles POSIX paths (Linux, macOS, Docker), which is what Next.js production hosts
          use. Frames that cannot be mapped are left unchanged. Columns can differ from Next&apos;s
          own log by a few characters. Lines match. Mapping runs only when an error is formatted.
        </p>
        <CodeBlock code={INSTRUMENTATION_FULL} lang="ts" caption="instrumentation.ts" />
        <p>
          Node&apos;s docs mark <code>process.setSourceMapsEnabled</code> as experimental and prefer{" "}
          <code>module.setSourceMapsSupport()</code> (Node 22.14+) or the{" "}
          <code>--enable-source-maps</code> flag. <code>register()</code> was checked on Node 20 and
          Node 24. The flag also makes Next&apos;s own console log readable.{" "}
          <code>NODE_OPTIONS=--enable-source-maps</code> does not rewrite <code>error.stack</code>{" "}
          inside <code>onRequestError</code> by itself; the helper does that. You can still start
          the server with the flag instead of calling <code>setSourceMapsEnabled</code>:
        </p>
        <CodeBlock code={START_FLAG} lang="json" caption="package.json scripts" />
        <CodeBlock code={WEBPACK_MAPS} lang="ts" caption="next.config.ts" />

        <h3>Docker / output: &quot;standalone&quot;</h3>
        <p>
          <code>output: &quot;standalone&quot;</code> does not copy most server maps into the
          standalone folder. In one build that left 7 of 46 maps, and the frame that mattered was
          not among them. Copy the maps after <code>next build</code>. They stay on the server.{" "}
          <code>.next/server</code> is not served as a public route.
        </p>
        <CodeBlock code={DOCKER_COPY} lang="dockerfile" caption="Dockerfile" />

        <h3>Vercel</h3>
        <p>
          We have not verified that Vercel ships <code>.next/server/**/*.map</code> with your
          functions. If frames stay minified there, you still get the real message, route, and
          digest.
        </p>

        <h3>Edge runtime</h3>
        <p>
          The helper is Node-only (<code>node:module</code> <code>findSourceMap</code>). Edge frames
          stay unmapped. The error is still reported, including its message. Next.js 16.3 prints
          that the Edge Runtime is deprecated.
        </p>

        <h2>Get told before your users tell you</h2>
        <p>
          Create a new-error-group alert (email, Slack, or Discord) under Alerts. It fires when
          ingest opens a new issue, which is the first time this server error is reported. Later
          occurrences of the same message and stack join that issue. See{" "}
          <Link href="/docs/alerts" className="text-brand hover:underline">
            alerts
          </Link>
          .
        </p>

        <h2>Troubleshooting</h2>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Symptom</th>
                <th className="px-4 py-3 font-medium">Cause</th>
                <th className="px-4 py-3 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 align-top">Nothing arrives</td>
                <td className="px-4 py-3 align-top">
                  <code>instrumentation.ts</code> is not at the project root (or <code>src/</code>),
                  or Next.js is older than 15.
                </td>
                <td className="px-4 py-3 align-top">Move the file. Upgrade to Next.js 15+.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">
                  <code>401</code> from ingest
                </td>
                <td className="px-4 py-3 align-top">
                  <code>TELEMETRY_API_KEY</code> is missing in the production environment.
                </td>
                <td className="px-4 py-3 align-top">
                  Set the server-only variable. Do not use a <code>NEXT_PUBLIC_</code> name for it.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">The UI error never shows up as an issue</td>
                <td className="px-4 py-3 align-top">
                  It was caught and not rethrown, it is a browser error, or it is{" "}
                  <code>DYNAMIC_SERVER_USAGE</code>.
                </td>
                <td className="px-4 py-3 align-top">
                  Rethrow unexpected failures. Browser errors use the client SDK. Dynamic server
                  usage is a Next.js control-flow error, not an <code>onRequestError</code> report.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Stack still minified</td>
                <td className="px-4 py-3 align-top">
                  Next.js 15 without <code>serverSourceMaps</code>, standalone without the copy
                  step, an Edge route, or Vercel (unverified).
                </td>
                <td className="px-4 py-3 align-top">
                  Turn server maps on, copy them into standalone, and keep the helper on the Node.js
                  runtime. You still have the real message, route, and digest.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Route Handler error has no digest</td>
                <td className="px-4 py-3 align-top">Expected.</td>
                <td className="px-4 py-3 align-top">
                  Match it by <code>routePath</code> and time.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Each user id makes a new issue</td>
                <td className="px-4 py-3 align-top">
                  Grouping uses the message. Dynamic values in the message split the issue.
                </td>
                <td className="px-4 py-3 align-top">Put ids in the context data, not the message.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>FAQ</h2>
        <h3>Can I just turn the redaction off?</h3>
        <p>
          Next.js does not support that, and you should not send the raw server error to the
          browser. Send it to your error tracker instead.
        </p>
        <h3>Is sending the real message to an error tracker safe?</h3>
        <p>
          It goes server to server. Telemetry Tracker scrubs common PII and secrets on ingest, on{" "}
          <code>message</code>, <code>stack</code>, and <code>context</code>, before storage.
        </p>
        <h3>Why is the browser message &quot;Minified React error #441&quot;?</h3>
        <p>
          That is React&apos;s production wording for the same Server Components sentence.{" "}
          <a href="https://react.dev/errors/441" className="text-brand hover:underline">
            react.dev/errors/441
          </a>{" "}
          decodes it.
        </p>
        <h3>Does this work with the Pages Router?</h3>
        <p>
          <code>onRequestError</code> receives Pages Router errors too. This guide only covers App
          Router behavior.
        </p>
        <h3>Do I need to upload server source maps?</h3>
        <p>
          No. They are read on the server at runtime. Uploads are for browser bundles.
        </p>

        <GuideCta
          heading="See the real error behind every digest."
          body="No credit card. Add instrumentation.ts, and the next production server error arrives with its real message, route and digest."
          secondaryHref="/error-tracking/nextjs"
          secondaryLabel="Next.js setup guide"
        />
        <p className="text-sm text-muted-foreground">
          Plan limits are on{" "}
          <Link href="/pricing" className="text-brand hover:underline">
            pricing
          </Link>
          .
        </p>
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/nextjs",
              label: "Next.js error tracking",
              description: "Browser provider and server instrumentation setup.",
            },
            {
              href: "/docs/nextjs",
              label: "Next.js SDK reference",
              description: "Env vars, provider, and createOnRequestError.",
            },
            {
              href: "/docs/alerts",
              label: "Alerts",
              description: "New error group, email, Slack, and Discord.",
            },
            {
              href: "/docs/source-maps",
              label: "Browser source maps",
              description: "Upload maps for client bundles. Server stacks are mapped in process.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
