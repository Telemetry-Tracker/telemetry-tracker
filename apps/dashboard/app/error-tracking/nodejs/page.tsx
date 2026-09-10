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
import { nodeInstall, nodeMiddleware, nodeSetup, nodeTestError } from "@/lib/sdk-setup-snippets";

const PATH = "/error-tracking/nodejs";
const TITLE = "Node.js Error Tracking";
const DESCRIPTION =
  "Install @telemetry-tracker/node, call init() in your entry file, and capture uncaughtException and unhandledRejection. Free hosted plan, no credit card.";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function NodeJsErrorTrackingPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({ origin, path: PATH, name: TITLE, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "Node.js error tracking", path: PATH },
          ]),
          howToJsonLd({
            name: "Set up Node.js error tracking with Telemetry Tracker",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Create a free account",
                text: "Register, create a project, and store the API key as TELEMETRY_API_KEY. No credit card is required.",
              },
              {
                name: "Install the Node SDK",
                text: "Add @telemetry-tracker/node to your server.",
              },
              {
                name: "Call init as early as possible",
                text: "Pass ingest URL, app name, and API key at the top of the entry file.",
              },
              {
                name: "Send a test error",
                text: "Call trackError or trigger an unhandled rejection, then open Issues.",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title="Node.js error tracking"
        lede={
          <p>
            <code>@telemetry-tracker/node</code> wraps core for servers. After <code>init()</code>,
            it installs handlers for <code>uncaughtException</code> and{" "}
            <code>unhandledRejection</code>, then rethrows / continues so your process can still exit
            or log as usual. Optional request middleware sends a <code>$request</code> event per HTTP
            call.
          </p>
        }
      >
        <p>
          NestJS uses the same package — see the{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS guide
          </Link>
          . Browser and Next.js apps should use core or{" "}
          <code>@telemetry-tracker/next</code>, not this package.
        </p>

        <h2>What the integration does</h2>
        <ul>
          <li>
            <code>init()</code> as early as possible in the entry file.
          </li>
          <li>
            Global handlers for uncaught exceptions and unhandled promise rejections.
          </li>
          <li>
            <code>trackError</code> / <code>trackEvent</code> for handled failures and server events.
          </li>
          <li>
            Optional <code>middleware()</code> for method, URL, and duration (
            <code>$request</code>).
          </li>
        </ul>

        <h2>Install</h2>
        <CodeBlock code={nodeInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>Call init at the top of your entry file. Keep the API key in an environment variable:</p>
        <CodeBlock code={nodeSetup} lang="typescript" caption="init" />

        <h2>Send a test error</h2>
        <CodeBlock code={nodeTestError} lang="typescript" caption="Test error" />
        <p>
          You can also throw an unhandled rejection once to confirm the global handler. Then open
          Issues in the dashboard.
        </p>

        <h2>Optional request middleware</h2>
        <p>
          Attach this to Express, Fastify, or similar so each request emits method, url, and{" "}
          <code>duration_ms</code>. Leave <code>trackRequestBody</code> false unless you have a reason
          to include bodies (PII and size).
        </p>
        <CodeBlock code={nodeMiddleware} lang="typescript" caption="middleware" />

        <h2>What you will see</h2>
        <p>
          Server errors group like browser issues: fingerprint, stack, and the context object you
          passed. Filter by <code>app</code> (here <code>my-api</code>) and <code>platform</code>{" "}
          <code>node</code>. Request events appear in Events if you enabled middleware.
        </p>
        <p>
          Free hosted plan: €0, no credit card, 250K ingest units per month, 14-day retention.{" "}
          <Link href="/#pricing" className="text-brand hover:underline">
            Pricing
          </Link>
          .
        </p>

        <h2>Full documentation</h2>
        <p>
          <Link href="/docs/node" className="text-brand hover:underline">
            Node.js SDK docs
          </Link>
          . NestJS bootstrap:{" "}
          <Link href="/docs/nestjs" className="text-brand hover:underline">
            NestJS
          </Link>
          . Account setup:{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud
          </Link>
          .
        </p>

        <GuideCta />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/nextjs",
              label: "Next.js error tracking",
              description: "Browser and App Router errors in the same project.",
            },
            {
              href: "/docs/node",
              label: "Node.js docs",
              description: "Handlers, middleware, and NestJS pointer.",
            },
            {
              href: "/docs/nestjs",
              label: "NestJS docs",
              description: "init in main.ts plus the same node package.",
            },
            {
              href: "/self-hosted-error-tracking",
              label: "Self-hosted error tracking",
              description: "Point TELEMETRY_INGEST_URL at your own API.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
