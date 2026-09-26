# Marketing site observability

The hosted dashboard and marketing site (`apps/dashboard`) still initialize Sentry from `instrumentation.ts` (`Sentry.captureRequestError`) and `@sentry/nextjs`.

## What Telemetry Tracker can cover

- Browser errors and page views, once `TelemetryProvider` is configured with a public ingest key. `ProductTelemetry` already does this when `NEXT_PUBLIC_TELEMETRY_*` is set.
- Server Component, Route Handler, and Server Action errors via `@telemetry-tracker/next/server` `createOnRequestError` (published in `@telemetry-tracker/next@1.3.2`). Wire it from `instrumentation.ts` when dogfooding server errors on this app.

## What Telemetry Tracker does not replace yet

Do not remove Sentry until these exist, if the site still needs them:

- Distributed tracing and performance spans
- Session replay
- Sentry’s webpack/Vercel source-map upload for this app’s own releases
- Alerting on the marketing site’s own server exceptions without the customer alert-rule product

Sentry stays in place so those gaps stay visible rather than silent.
