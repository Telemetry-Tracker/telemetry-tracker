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
import { reactInstall, reactSetup, reactTestError } from "@/lib/sdk-setup-snippets";

const PATH = "/error-tracking/react";
const TITLE = "React Error Tracking";
const DESCRIPTION =
  "Add @telemetry-tracker/core to a React app, call init(), and send the first error with trackError. Free hosted plan, no credit card.";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function ReactErrorTrackingPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({ origin, path: PATH, name: TITLE, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "React error tracking", path: PATH },
          ]),
          howToJsonLd({
            name: "Set up React error tracking with Telemetry Tracker",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Create a free account",
                text: "Register, create a project, and copy a tt_live API key. No credit card is required.",
              },
              {
                name: "Install the core SDK",
                text: "Add @telemetry-tracker/core to your React app.",
              },
              {
                name: "Call init at app entry",
                text: "Pass the hosted ingest URL, app name, and API key before rendering the tree.",
              },
              {
                name: "Send a test error",
                text: "Call trackError, then open Issues in the dashboard.",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title="React error tracking"
        lede={
          <p>
            React SPAs use <code>@telemetry-tracker/core</code>. Call <code>init()</code> once at
            startup. After that, uncaught errors and unhandled promise rejections in the browser are
            reported automatically. Use <code>trackError</code> for handled exceptions.
          </p>
        }
      >
        <p>
          Next.js apps should use{" "}
          <Link href="/error-tracking/nextjs" className="text-brand hover:underline">
            @telemetry-tracker/next
          </Link>{" "}
          instead (provider, error boundary, page hook). Vue and Nuxt also use core — see the{" "}
          <Link href="/docs/vue" className="text-brand hover:underline">
            Vue
          </Link>{" "}
          and{" "}
          <Link href="/docs/nuxt" className="text-brand hover:underline">
            Nuxt
          </Link>{" "}
          docs. This page is the React / Vite path.
        </p>

        <h2>What the integration does</h2>
        <ul>
          <li>
            <code>init()</code> starts batching to the ingest API.
          </li>
          <li>Global browser handlers capture uncaught errors after init.</li>
          <li>
            <code>trackError</code> sends handled errors with optional context.
          </li>
          <li>
            <code>trackEvent</code>, <code>screen</code>, and <code>identify</code> cover product
            events, page views, and user identity.
          </li>
        </ul>

        <h2>Install</h2>
        <CodeBlock code={reactInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>
          Initialize at app entry (for example <code>main.tsx</code>) with the hosted ingest URL and
          your project API key:
        </p>
        <CodeBlock code={reactSetup} lang="typescript" caption="init and helpers" />
        <p>
          Required config: <code>ingestUrl</code> and <code>app</code>. Hosted cloud also needs{" "}
          <code>apiKey</code>. Optional: <code>environment</code>, <code>release</code>,{" "}
          <code>piiScrub</code>.
        </p>

        <h2>Send a test error</h2>
        <p>
          Trigger this from a click handler, then open Issues. If nothing appears, confirm the key
          and that ingest is <code>https://api.telemetry-tracker.com</code>.
        </p>
        <CodeBlock code={reactTestError} lang="typescript" caption="Test error" />

        <h2>What you will see</h2>
        <p>
          Errors are fingerprinted and grouped. The issue view shows stack, occurrence count, and
          context you passed to <code>trackError</code>. Sessions and events from the same{" "}
          <code>app</code> string show up in the same project filters.
        </p>
        <p>
          Free hosted plan: €0, no credit card, 250K ingest units per month, 14-day retention, one
          project.{" "}
          <Link href="/#pricing" className="text-brand hover:underline">
            Pricing
          </Link>
          .
        </p>

        <h2>Full documentation</h2>
        <p>
          <Link href="/docs/sdk" className="text-brand hover:underline">
            SDK reference
          </Link>{" "}
          for init options, identity, and PII scrubbing.{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud
          </Link>{" "}
          for account and API key steps.
        </p>

        <GuideCta />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/nextjs",
              label: "Next.js error tracking",
              description: "Provider, error boundary, and App Router page views.",
            },
            {
              href: "/error-tracking/react-native",
              label: "React Native error tracking",
              description: "ErrorUtils, sessions, and screens.",
            },
            {
              href: "/docs/sdk",
              label: "SDK docs",
              description: "init(), events, identity, and app naming.",
            },
            {
              href: "/self-hosted-error-tracking",
              label: "Self-hosted error tracking",
              description: "Run the same SDK against your own API.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
