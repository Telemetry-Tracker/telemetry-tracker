import type { Metadata } from "next";
import Link from "next/link";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Alerts",
  description:
    "Which Telemetry Tracker alert rules fire on ingest, and which ones need the scheduled evaluator cron.",
  alternates: { canonical: "./" },
};

export default function DocsAlertsPage() {
  return (
    <DocsArticle
      title="Alerts"
      lede={
        <p>
          Custom rules are AND groups of conditions. The dashboard rule editor authors error-count and
          &ldquo;no events&rdquo; (business heartbeat) conditions; other condition types are API-only. Delivery is in-app notifications, email, HTTPS webhooks, Slack,
          Discord, Microsoft Teams and Telegram. Slack, Discord and Microsoft Teams use incoming
          webhook URLs (Teams uses legacy Office 365 MessageCard webhooks). Telegram uses a bot{" "}
          <code>sendMessage</code> URL. These are not OAuth app installs. The Email channel in notification settings must be on or
          email is skipped.
        </p>
      }
    >
      <h2>Fires when an error is ingested</h2>
      <ul>
        <li>
          <code>ERROR_COUNT</code>
        </li>
        <li>
          <code>NEW_ERROR_GROUP</code>
        </li>
        <li>
          <code>AFFECTED_USERS</code>
        </li>
        <li>
          <code>ERROR_RATE</code> is also checked on ingest. It is checked again on the schedule so
          it can fire when no new error arrives.
        </li>
      </ul>

      <h2>Needs the evaluator cron</h2>
      <p>
        These do nothing until <code>node dist/jobs/run-alert-rules-evaluator.js</code> runs. The
        intended cadence is every 5 minutes. Hosted cloud runs that as a Railway cron. A self-hosted
        install must schedule it separately. That process needs both{" "}
        <code>RESEND_API_KEY</code> and <code>TELEMETRY_EMAIL_FROM</code> (either alone is not
        enough). Alert email links use <code>TELEMETRY_DASHBOARD_ORIGIN</code>, not{" "}
        <code>DASHBOARD_ORIGIN</code>. Without those, evaluation still fires in-app alerts while
        email stays silent.
      </p>
      <ul>
        <li>
          <code>NO_EVENTS</code>
        </li>
        <li>
          <code>HEARTBEAT</code>
        </li>
        <li>
          <code>SESSION_DROP</code>
        </li>
        <li>
          <code>QUOTA_PERCENT</code>
        </li>
        <li>
          <code>ERROR_RATE</code> between error ingests
        </li>
      </ul>
      <h2>Business heartbeats</h2>
      <p>
        Some failures throw nothing: a verification email is never sent, a webhook returns 200 but
        skips the work, a nightly job never runs. Track an event when the flow succeeds, then alert
        when that event has not arrived for a number of hours.
      </p>
      <pre><code>{`trackEvent("signup_verified");          // user confirmed their email
trackEvent("stripe_webhook_processed"); // webhook handler finished the work
trackEvent("daily_report_finished");    // last line of the nightly job`}</code></pre>
      <p>
        In Alerts → Custom rules, choose <strong>No events (heartbeat)</strong>, enter the exact
        event name and how many hours without it should alert. Through the API that is a{" "}
        <code>NO_EVENTS</code> condition with <code>eventName</code>:
      </p>
      <pre><code>{`{ "type": "NO_EVENTS", "eventName": "signup_verified",
  "windowMinutes": 360, "environment": "production" }`}</code></pre>
      <ul>
        <li>
          Pick a window comfortably longer than the normal gap between those events. A small app can
          go hours without a signup; check the Events page first.
        </li>
        <li>
          The window is at most 24 hours. The dashboard defaults to 6 hours with a cooldown equal to
          the window.
        </li>
        <li>
          There is no recovery notification. While the event stays missing the rule fires again
          every cooldown. For job deadlines with down and recovery alerts, use{" "}
          <Link href="/docs/checkins">check-ins</Link>.
        </li>
        <li>
          Without <code>eventName</code>, <code>NO_EVENTS</code> alerts when no event at all
          arrived, as before.
        </li>
      </ul>

      <p>
        <code>GET /health</code> includes <code>alert_rules_evaluator</code>: <code>ok</code>,{" "}
        <code>stale</code>, or <code>never</code>. That field does not fail the API health check.
      </p>

      <DocsAlsoSee
        links={[
          { href: "/docs/self-hosting", label: "Self-hosting" },
          { href: "/docs/checkins", label: "Check-ins" },
          { href: "/dashboard/alerts", label: "Alerts in the dashboard" },
        ]}
      />
    </DocsArticle>
  );
}
