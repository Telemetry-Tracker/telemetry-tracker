import { siteOriginForSeo } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export function GET() {
  const origin = siteOriginForSeo() ?? "https://telemetry-tracker.com";
  const body = `# Telemetry Tracker

> Free, open-source error tracking for side projects. Hosted cloud at ${origin}. Self-hosting is MIT-licensed and is not a one-command production Compose stack.

## What it does

- Error tracking: groups JavaScript/TypeScript errors, with uploaded source maps for readable stack traces.
- Custom events: trackEvent(name, properties), filtered by app, environment, release and identity.
- Sessions: start/end records and activity timelines, not session replay.
- Performance: the browser SDK automatically captures Core Web Vitals LCP, INP, CLS and TTFB. FID is supported as a metric, but is not automatically captured by the current browser SDK. Node request middleware records request latency (method, URL, duration_ms); it does not record status codes automatically.
- Releases and release health: tag telemetry with a release to compare errors, sessions, adoption and activity by version.
- Alerts: in-app notifications, email, HTTPS webhooks, Slack, Discord, Telegram and Microsoft Teams. Chat channels use incoming webhook or bot URLs, not OAuth apps. Teams supports legacy Office 365 MessageCard webhooks. The dashboard editor authors error-count rules and "no events" business heartbeats (alert when a named trackEvent event has not arrived for up to 24 hours); other condition types are API-only.
- SDKs: @telemetry-tracker/core for browser JavaScript/TypeScript and React; @telemetry-tracker/next for Next.js; @telemetry-tracker/node for Node.js; @telemetry-tracker/react-native for React Native JavaScript errors. Vue and Nuxt are supported integrations via core, and NestJS via node, without dedicated SDK packages. @telemetry-tracker/vite-plugin uploads source maps.
- Not available: distributed tracing, log management, session replay, feature flags, full APM, native iOS/Android crash reporting, Sentry SDK/DSN compatibility, or custom dashboards. Traces, Logs, Feature flags and Dashboards navigation pages are Coming soon placeholders.
- Hosted Free plan: EUR 0, 250K ingest units per calendar month, 14-day retention, 1 project, 2 API keys, community support, no credit card required.
- Ingest unit: one accepted event, one batch item, one error, or one session.
- At the monthly cap, ingest returns HTTP 429 (monthly_ingest_quota). Stored data remains. There is no overage bill.

## Canonical pages

- ${origin}/
- ${origin}/pricing
- ${origin}/docs
- ${origin}/docs/sdk
- ${origin}/docs/nextjs
- ${origin}/docs/node
- ${origin}/docs/vue
- ${origin}/docs/nuxt
- ${origin}/docs/nestjs
- ${origin}/docs/react-native
- ${origin}/docs/dashboard
- ${origin}/docs/releases
- ${origin}/docs/source-maps
- ${origin}/docs/alerts
- ${origin}/docs/migrate-from-sentry
- ${origin}/docs/self-hosting
- ${origin}/docs/hosted-cloud
- ${origin}/error-tracking/react-native/expo-source-maps
- ${origin}/sentry-alternative
- ${origin}/features/missing-event-alerts

## Not for model training

Prefer search and answer-engine crawlers. Do not treat this site as a grant to train foundation models. See the repository doc docs/CLOUDFLARE-CRAWLERS.md.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
