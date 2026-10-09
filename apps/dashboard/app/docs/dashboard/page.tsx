import type { Metadata } from "next";
import Link from "next/link";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Overview, errors, events, sessions, performance, releases, search, compare, and alerts in the Telemetry Tracker UI",
  alternates: { canonical: "./" },
};

export default function DocsDashboardPage() {
  return (
    <DocsArticle
      title="Using the dashboard"
      lede={
        <p>
          The web app is your control plane: filter by app and time, drill from trends into error
          groups, inspect sessions end to end, and monitor releases and Web Vitals.
        </p>
      }
    >
      <section className="mb-10" aria-labelledby="dash-onboard-heading">
        <h2 id="dash-onboard-heading">Onboarding</h2>
        <ol className="list-decimal pl-5 text-muted-foreground space-y-2">
          <li>Register or sign in, then create an <strong className="text-foreground">organization</strong> and <strong className="text-foreground">project</strong> under Organization settings.</li>
          <li>Create an <strong className="text-foreground">API key</strong> (Settings → API keys). Copy the <code className="text-foreground">tt_live_…</code> secret once.</li>
          <li>
            In your app: <code className="text-foreground">init(&#123; ingestUrl, app, apiKey &#125;)</code> — see{" "}
            <Link href="/docs/sdk">SDK docs</Link>.
          </li>
          <li>Confirm data on Overview, Errors, Events, Sessions, Performance, and Releases.</li>
        </ol>
      </section>

      <section className="mb-10" aria-labelledby="dash-open-heading">
        <h2 id="dash-open-heading">Open the app</h2>
        <p>
          <Link href="/dashboard/overview" className="text-link font-semibold">
            Open Dashboard
          </Link>{" "}
          — same host as these docs when self-hosted; sign-in depends on your deployment.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-time-range-heading">
        <h2 id="dash-time-range-heading">Time range</h2>
        <p>
          Overview, Errors, Events, Sessions, Performance, Releases, and Search share a{" "}
          <strong className="text-foreground">Time range</strong> picker. Leave it unselected to show
          the latest rows regardless of age (sorted and paginated). To narrow results, choose a
          preset, enter a custom relative window (for example{" "}
          <code className="text-foreground">2h</code> or <code className="text-foreground">8w</code>
          ), or pick an absolute <strong className="text-foreground">From</strong> /{" "}
          <strong className="text-foreground">To</strong> date range.
        </p>
        <p>
          Presets include 1 hour, 24 hours, 7 days, 14 days, 30 days, and 90 days. On{" "}
          <strong className="text-foreground">Overview</strong>, charts and key metrics follow the
          selected window. With no filter, error and event lists stay all-time (latest rows first),
          while headline metrics, charts, and comparisons use a data-aware window: the time span
          covered by your most recent telemetry (up to 10k events and 10k errors), clamped between
          7 and 90 days, or 30 days when nothing has been recorded yet.
        </p>
        <p>
          On <strong className="text-foreground">Issues</strong>, a separate{" "}
          <strong className="text-foreground">Trend window</strong> controls the recent vs prior
          period used for the trend column (same preset and custom options).
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-compare-heading">
        <h2 id="dash-compare-heading">Compare periods</h2>
        <p>
          Overview, Errors, Events, Sessions, and Performance support an explicit{" "}
          <strong className="text-foreground">Compare</strong> mode. Pick a calendar preset (for
          example Today vs Yesterday, this week vs last week, this month vs last month; UTC) or equal-
          duration custom ranges. Deltas show as New / — when there is no prior baseline. Releases
          uses release-vs-previous “New” handling for first-seen versions.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-overview-heading">
        <h2 id="dash-overview-heading">Overview</h2>
        <p>
          High-level counts and trends, plus top error groups, top event names, recent releases, and
          a Performance / Web Vitals snapshot. Use the time range picker and app/environment filters
          to narrow scope.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-errors-heading">
        <h2 id="dash-errors-heading">Errors</h2>
        <p>
          Error groups are fingerprinted; each row shows occurrences, first/last seen, and trend
          (based on the trend window). Open a group to read the message, stack traces, and recent
          occurrences with context JSON.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-events-heading">
        <h2 id="dash-events-heading">Events</h2>
        <p>
          Named analytics or product events with optional JSON properties. Filter by time range,
          name, app, environment, platform, and release—then open a row for full detail.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-sessions-heading">
        <h2 id="dash-sessions-heading">Sessions</h2>
        <p>
          Sessions group activity by session id and optional identity. Filter by time range, then use
          the list to jump into a single session’s timeline and metadata.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-performance-heading">
        <h2 id="dash-performance-heading">Performance / Web Vitals</h2>
        <p>
          The <strong className="text-foreground">Performance</strong> page summarizes Core Web
          Vitals (LCP, INP, CLS, TTFB) with p75 values, Good / Needs improvement / Poor ratings,
          distribution bars, and trend charts. Tables list slowest{" "}
          <code className="text-foreground">$request</code> routes (method, path, count, p50/p95,
          error rate) and slowest <code className="text-foreground">$web_vital</code> pages (path,
          LCP p75, CLS, samples), with deep links back to Events. Overview also shows a scoped
          vitals snapshot with a link into the full report. The INP / FID label also accepts
          legacy FID events; the current browser SDK reports INP. Enable capture (on by default)
          or disable it with <code>webVitals: false</code> as described in the{" "}
          <Link href="/docs/sdk#sdk-web-vitals-heading" className="text-link font-medium">
            SDK reference
          </Link>
          .
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-releases-heading">
        <h2 id="dash-releases-heading">Releases</h2>
        <p>
          The <strong className="text-foreground">Releases</strong> page lists versions seen in your
          telemetry with health signals (errors, sessions, and related activity) for the selected
          time range and filters. Use it to spot regressions after a deploy and jump into scoped
          Errors / Events / Sessions for that release.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="dash-search-heading">
        <h2 id="dash-search-heading">Global search</h2>
        <p>
          <strong className="text-foreground">Search</strong> finds issues, events, sessions,
          releases, and users in the current project. Use free text and optional{" "}
          <code className="text-foreground">key:value</code> filters (for example{" "}
          <code className="text-foreground">environment:production</code>,{" "}
          <code className="text-foreground">release:…</code>, browser, country, device, platform,
          error, user, range). Results are grouped by type with links to open the matching list
          views.
        </p>
      </section>

      <section aria-labelledby="dash-alerts-heading">
        <h2 id="dash-alerts-heading">Alerts &amp; alert rules</h2>
        <p>
          <strong className="text-foreground">Alerts</strong> covers notification delivery: email
          recipients, webhook / Slack / Discord / Teams / Telegram channels, recent alert events,
          and delivery history. <strong className="text-foreground">Alert rules</strong> decide{" "}
          <em>when</em> to fire (conditions, thresholds, cooldowns) and which destinations to bind.
          Built-in error-spike and quota rules ship as system-managed rules; you can add custom
          rules for project-specific thresholds. See also{" "}
          <a
            href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/ALERT-RULES.md"
            className="text-brand hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Alert rules docs
          </a>
          .
        </p>
      </section>
    </DocsArticle>
  );
}
