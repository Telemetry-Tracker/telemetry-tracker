import type { Metadata } from "next";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
import { HOSTED_API_URL } from "@/lib/hosted-cloud";

export const metadata: Metadata = {
  title: "Same-origin ingest proxy",
  description:
    "Point the SDK ingestUrl at your own origin so ad-blockers are less likely to drop error reports.",
  alternates: { canonical: "./" },
};

const nextRewrites = `/** next.config.ts */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/tt/ingest/:path*",
        destination: "${HOSTED_API_URL}/ingest/:path*",
      },
    ];
  },
};

export default nextConfig;`;

const nextInit = `init({
  // Same origin — browser calls your app, Next.js proxies to TT
  ingestUrl: typeof window !== "undefined" ? \`\${window.location.origin}/tt\` : "http://localhost:3000/tt",
  app: "my-next-app",
  apiKey: process.env.NEXT_PUBLIC_TELEMETRY_API_KEY,
});`;

const nginxConf = `# /etc/nginx/conf.d/tt-ingest-proxy.conf  (snippet)
# Terminate TLS on your site as usual; only the /tt/ingest/* location is shown.

location /tt/ingest/ {
  proxy_pass ${HOSTED_API_URL}/ingest/;
  proxy_http_version 1.1;
  proxy_set_header Host api.telemetry-tracker.com;
  proxy_set_header Authorization $http_authorization;
  proxy_set_header X-API-Key $http_x_api_key;
  proxy_set_header Content-Type $http_content_type;
  proxy_pass_request_body on;
  # nginx forwards unlisted request headers by default — clear spoofable IPs.
  proxy_set_header X-Forwarded-For "";
  proxy_set_header X-Real-IP "";
  proxy_set_header CF-Connecting-IP "";
  proxy_set_header True-Client-IP "";
  # Rate limits will use this proxy's egress IP (still partitioned by API key).
}`;

const workerJs = `// Cloudflare Worker — relay /tt/ingest/* to hosted ingest
// Bind a route like https://your.app/tt/*

const UPSTREAM = "${HOSTED_API_URL}";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/tt/ingest")) {
      return new Response("Not found", { status: 404 });
    }
    const path = url.pathname.slice("/tt".length) + url.search;
    // Copy auth + content-type only — do not forward spoofable visitor-IP headers.
    const headers = new Headers();
    const auth = request.headers.get("authorization");
    const xKey = request.headers.get("x-api-key");
    const ct = request.headers.get("content-type");
    if (auth) headers.set("authorization", auth);
    if (xKey) headers.set("x-api-key", xKey);
    if (ct) headers.set("content-type", ct);
    headers.set("Host", "api.telemetry-tracker.com");
    const init = {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    };
    return fetch(UPSTREAM + path, init);
  },
};`;

export default function DocsIngestProxyPage() {
  return (
    <DocsArticle
      title="Same-origin ingest proxy"
      lede={
        <p>
          Some ad-blockers and tracking filters drop requests to third-party error ingest hosts. Our
          SDKs already accept any <code>ingestUrl</code>. You can point that URL at a path on{" "}
          <em>your</em> origin and reverse-proxy <code>/ingest/*</code> to us. This page is docs
          only — we do not ship a Sentry-style <code>tunnelRoute</code> helper.
        </p>
      }
    >
      <h2>When to use this</h2>
      <ul>
        <li>Browser or Next.js apps where ingest to <code>{HOSTED_API_URL}</code> is blocked.</li>
        <li>
          Whether that host is on a given blocklist is <strong>UNVERIFIED</strong> — measure in your
          audience before investing in a proxy.
        </li>
      </ul>

      <h2>Safe setup (recommended)</h2>
      <ol>
        <li>
          Choose a same-origin prefix, for example <code>/tt</code>.
        </li>
        <li>
          Proxy <code>/tt/ingest/session</code>, <code>/tt/ingest/error</code>,{" "}
          <code>/tt/ingest/event</code>, and <code>/tt/ingest/batch</code> to the same paths on{" "}
          <code>{HOSTED_API_URL}</code>.
        </li>
        <li>
          Forward <code>Authorization</code> (or <code>X-API-Key</code>), <code>Content-Type</code>,
          and the request body. Use HTTPS end to end.
        </li>
        <li>
          Set SDK <code>ingestUrl</code> to <code>https://your.app/tt</code> (no trailing slash).
        </li>
        <li>
          Do <strong>not</strong> forward untrusted client IP headers to invent a visitor IP. See
          rate limits below.
        </li>
      </ol>

      <h2>Rate limits and client IP</h2>
      <p>
        Hosted ingest rate limits key on a resolved client IP plus the API key&apos;s public id
        (see the client IP fix in #788). The resolver trusts:
      </p>
      <ul>
        <li>
          <code>cf-connecting-ip</code> only when the immediate peer is a Cloudflare address
        </li>
        <li>
          <code>x-real-ip</code> from the Railway edge when that trust flag is enabled
        </li>
        <li>
          <code>x-tt-client-ip</code> only with a shared secret used by our dashboard affiliate path —
          <strong>not</strong> for customer tunnels
        </li>
      </ul>
      <p>
        A normal Next.js / nginx / Worker proxy therefore makes the rate-limit IP the{" "}
        <strong>proxy egress</strong>, shared by your users, still partitioned per project key.
        That is acceptable for most apps. Forwarding arbitrary <code>X-Forwarded-For</code> /{" "}
        <code>X-Real-IP</code> values from the browser would enable spoofing — we do{" "}
        <strong>not</strong> recommend it, and our API does not treat those as visitor IPs unless
        they come from the trusted edges above.
      </p>

      <h2>Next.js rewrites</h2>
      <p>
        App Router / Pages: add a rewrite, then point <code>ingestUrl</code> at your site origin +{" "}
        <code>/tt</code>. Rewrites proxy on the server; the browser only talks to you.
      </p>
      <CodeBlock code={nextRewrites} lang="ts" caption="next.config.ts" />
      <CodeBlock code={nextInit} lang="ts" caption="SDK init (browser)" />
      <p>
        Confirm with your project key: create an error and check that{" "}
        <code>/tt/ingest/error</code> returns <code>204</code> and the issue appears. Without a key
        you should see <code>401</code> from our API through the rewrite (path forwarding works).
        Next.js rewrites pass client headers through (including{" "}
        <code>X-Forwarded-For</code> / <code>X-Real-IP</code> / <code>CF-Connecting-IP</code>); our
        API does not treat those as visitor IPs unless they come from a trusted edge (#788), so the
        rate-limit IP is still this proxy&apos;s egress. Prefer a Route Handler that copies only
        auth + body if you want to strip those headers yourself.
      </p>

      <h2>nginx</h2>
      <CodeBlock code={nginxConf} lang="nginx" caption="nginx location snippet" />
      <p>
        Verified in Docker (<code>nginx:1.27-alpine</code>): auth + body reach upstream as{" "}
        <code>204</code>; without the clear headers above, nginx also forwards spoofable client IP
        headers — keep the <code>proxy_set_header … &quot;&quot;</code> lines. Also verified: Node{" "}
        <code>/tt</code> relay to production ingest returns <code>204</code> with a live project key.
      </p>

      <h2>Cloudflare Worker</h2>
      <CodeBlock code={workerJs} lang="js" caption="worker.js" />
      <p>
        Attach the Worker to <code>your.app/tt/*</code>. Verified with{" "}
        <code>wrangler dev</code>: auth + body forward (<code>204</code>); copying{" "}
        <code>request.headers</code> wholesale also forwarded spoofable IPs — the snippet above
        copies only auth + content-type.
      </p>

      <h2>Production readiness</h2>
      <ul>
        <li>
          <strong>Supported:</strong> custom <code>ingestUrl</code> + reverse proxy that preserves
          method, body, and API key headers.
        </li>
        <li>
          <strong>Not provided:</strong> a first-party tunnel SDK option or managed{" "}
          <code>tunnel: true</code>.
        </li>
        <li>
          <strong>Verify yourself</strong> with a project API key (204) before relying on a proxy in
          production. Path forwarding alone is not enough.
        </li>
      </ul>

      <DocsAlsoSee
        links={[
          { href: "/docs/sdk", label: "SDK reference" },
          { href: "/docs/nextjs", label: "Next.js" },
          { href: "/docs/hosted-cloud", label: "Hosted cloud" },
        ]}
      />
    </DocsArticle>
  );
}
