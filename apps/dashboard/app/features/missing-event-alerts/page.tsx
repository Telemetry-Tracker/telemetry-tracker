import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
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

const PATH = "/features/missing-event-alerts";
const TITLE = "Alert When Events Stop Arriving: Missing-Event Alerts";
const H1 = "Get alerted when an event you expect stops arriving";
const DESCRIPTION =
  "Get an email when an expected event, like signup_verified or a processed webhook, hasn't arrived for 1–24 hours. Built on the trackEvent calls you already send.";

const FAQ = [
  {
    question: "What is a business heartbeat?",
    answer:
      "A custom event your app sends when a key flow succeeds. We alert you when none arrive in the window you choose.",
  },
  {
    question: "Does this monitor my payments or signups automatically?",
    answer: "No. You send the event from your code. We only see the events you track.",
  },
  {
    question: "How quickly will I hear about it?",
    answer:
      "After the window passes, on the next scheduled evaluation (by default every 5 minutes). It is not real-time.",
  },
  {
    question: "Can I limit it to production?",
    answer: "Yes. Each rule has an optional environment filter.",
  },
  {
    question: "Do I get a recovery alert?",
    answer: "No. The alerts stop when the events come back.",
  },
  {
    question: "How is this different from cron check-ins?",
    answer:
      "Check-ins are for scheduled jobs, with ping URLs and deadlines. Heartbeats are for events your app flows send.",
  },
] as const;

const TRACK = `import { trackEvent } from "@telemetry-tracker/node"; // or @telemetry-tracker/next, @telemetry-tracker/react-native

// Call it after the flow actually succeeded
trackEvent("signup_verified");`;

const linkClass = "text-brand hover:underline";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    omitBrandSuffix: true,
  });
}

export default function MissingEventAlertsPage() {
  const origin = marketingSiteOrigin();

  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({ origin, path: PATH, name: H1, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "Missing-event alerts", path: PATH },
          ]),
          faqPageJsonLd(FAQ),
        ]}
      />
      <MarketingGuideLayout
        kicker="Alerts"
        title={H1}
        updated="2026-10"
        lede={
          <>
            Error tracking only sees code that throws. Some failures throw nothing: the verification
            email never goes out, a webhook returns 200 but skips the work, a nightly job never
            runs. We call the fix business heartbeats: send an event when the flow succeeds, and
            we&apos;ll email you when it goes missing.
          </>
        }
      >
        <h2>How it works</h2>
        <ol>
          <li>
            Call <code>trackEvent(&quot;signup_verified&quot;)</code> after the flow succeeds, with
            the{" "}
            <Link href="/docs/node" className={linkClass}>
              Node
            </Link>
            ,{" "}
            <Link href="/docs/nextjs" className={linkClass}>
              Next.js
            </Link>{" "}
            or{" "}
            <Link href="/docs/react-native" className={linkClass}>
              React Native
            </Link>{" "}
            SDK.
          </li>
          <li>
            Add a <strong>No events (heartbeat)</strong> alert rule for that exact event name, with
            a window of 1–24 hours and an optional environment.
          </li>
          <li>
            When the event goes missing, the alert names it (for example{" "}
            <em>no &quot;signup_verified&quot; events in the last 6 hours in production</em>) and
            links to the Events page filtered to that event.
          </li>
        </ol>
        <CodeBlock code={TRACK} lang="ts" caption="After the flow succeeds" />
        <p>
          We email you by default. The same alert also shows up in your in-app notifications, and
          you can send it to HTTPS webhooks, Slack, Discord, Microsoft Teams or Telegram channels
          you have set up for the project.
        </p>
        <p>
          Step-by-step setup, including the API version of the rule, is in the{" "}
          <Link href="/docs/alerts#business-heartbeats" className={linkClass}>
            business heartbeats setup
          </Link>{" "}
          docs. Every event goes through the{" "}
          <Link href="/docs/sdk" className={linkClass}>
            SDK
          </Link>{" "}
          you already use for errors, so the alert sits next to your issues.
        </p>

        <h2>What to monitor</h2>
        <h3>Signup verification</h3>
        <p>
          Send <code>signup_verified</code> when a user confirms their email. A heartbeat can tell
          you when those stop arriving, for example because verification emails stopped going out.
          A small app can go hours without a signup, so start with a 6–12 hour window.
        </p>
        <h3>Payment webhook processed</h3>
        <p>
          Send <code>stripe_webhook_processed</code> after your handler did the work, not when the
          request arrives. A handler that returns 200 and skips the event then shows up as missing.
          Pick a window a few times your normal gap between webhooks.
        </p>
        <h3>Nightly job finished</h3>
        <p>
          Send <code>daily_report_finished</code> as the last line of the job. The window can be at
          most 24 hours, which leaves little slack for a daily job. For job deadlines, consider{" "}
          <Link href="/docs/checkins" className={linkClass}>
            check-ins
          </Link>{" "}
          instead.
        </p>

        <h2>Choosing a window</h2>
        <ul>
          <li>Make it comfortably longer than the normal gap between those events.</li>
          <li>Check the Events page first to see how often the event really arrives.</li>
          <li>
            At low traffic, quiet nights and weekends cause false alerts if the window is too short.
          </li>
          <li>The dashboard defaults to 6 hours, with a cooldown equal to the window.</li>
        </ul>

        <h2>Limits</h2>
        <p>We&apos;d rather you know these up front:</p>
        <ul>
          <li>Each condition watches one exact event name.</li>
          <li>The window is at most 24 hours.</li>
          <li>
            It is not real-time. Rules are checked about every 5 minutes, so
            you hear about it after your window plus up to one check.
          </li>
          <li>
            Recovery notifications aren&apos;t supported yet. While the event stays missing, the rule fires again
            every cooldown, and it stops when events come back.
          </li>
          <li>There is no learned baseline or anomaly detection. You choose the window.</li>
          <li>
            You instrument and send the event yourself. Nothing is monitored that you don&apos;t
            track, so we can&apos;t guarantee that your signups or payments are covered.
          </li>
          <li>
            If you{" "}
            <Link href="/docs/self-hosting" className={linkClass}>
              self-host
            </Link>
            , you need to run the alert-rules evaluator cron.
          </li>
        </ul>

        <h2>Heartbeats vs check-ins</h2>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium" />
                <th className="px-4 py-3 font-medium">Business heartbeat</th>
                <th className="px-4 py-3 font-medium">Check-ins</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-3 align-top">Signal</td>
                <td className="px-4 py-3 align-top">Custom event via the SDK</td>
                <td className="px-4 py-3 align-top">Request to a secret ping URL</td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Best for</td>
                <td className="px-4 py-3 align-top">Irregular, user-driven flows</td>
                <td className="px-4 py-3 align-top">Cron and time-zone schedules, runtime deadlines</td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Configured as</td>
                <td className="px-4 py-3 align-top">An alert rule</td>
                <td className="px-4 py-3 align-top">A check-in monitor</td>
              </tr>
              <tr>
                <td className="px-4 py-3 align-top">Recovery</td>
                <td className="px-4 py-3 align-top">No recovery notification</td>
                <td className="px-4 py-3 align-top">Down and recovery states</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          See{" "}
          <Link href="/docs/checkins" className={linkClass}>
            cron and background-job check-ins
          </Link>{" "}
          for scheduled jobs.
        </p>

        <h2>FAQ</h2>
        {FAQ.map((item) => (
          <div key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </div>
        ))}

        <GuideCta
          heading="Know when a key flow goes quiet"
          body="Send one event when a key flow succeeds, add a No events (heartbeat) rule, and we'll email you when it goes missing."
          primaryLabel="Add your first heartbeat"
          secondaryHref="/docs/alerts#business-heartbeats"
          secondaryLabel="Read the setup guide"
        />
        <p className="text-sm text-muted-foreground">
          Plans are on{" "}
          <Link href="/pricing" className={linkClass}>
            pricing
          </Link>
          . Questions? Write to{" "}
          <a href="mailto:info@telemetry-tracker.com" className={linkClass}>
            info@telemetry-tracker.com
          </a>
          .
        </p>
        <GuideRelatedLinks
          links={[
            {
              href: "/docs/alerts#business-heartbeats",
              label: "Business heartbeats setup",
              description: "Rule editor fields, API condition and window advice.",
            },
            {
              href: "/docs/checkins",
              label: "Check-ins",
              description: "Ping URLs for cron and background jobs, with recovery.",
            },
            {
              href: "/error-tracking/nodejs",
              label: "Node.js error tracking",
              description: "Install the Node SDK that also sends your events.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
