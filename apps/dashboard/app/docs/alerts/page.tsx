import type { Metadata } from "next";
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
          Custom rules are AND groups of conditions. Delivery is in-app, email, and optional
          webhooks. The Email channel in notification settings must be on or email is skipped.
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
        install must schedule it separately.
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
      <p>
        <code>GET /health</code> includes <code>alert_rules_evaluator</code>: <code>ok</code>,{" "}
        <code>stale</code>, or <code>never</code>. That field does not fail the API health check.
      </p>

      <DocsAlsoSee
        links={[
          { href: "/docs/self-hosting", label: "Self-hosting" },
          { href: "/dashboard/alerts", label: "Alerts in the dashboard" },
        ]}
      />
    </DocsArticle>
  );
}
