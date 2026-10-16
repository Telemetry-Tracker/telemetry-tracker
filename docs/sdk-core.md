# @telemetry-tracker/core

Shared SDK used by all platform packages. Use it directly in any JavaScript/TypeScript app (browser, Node, React Native) when you don’t need framework-specific helpers.

## Install

In a monorepo workspace:

```bash
pnpm add @telemetry-tracker/core
```

Or link via workspace: depend on `"@telemetry-tracker/core": "workspace:*"` in your app’s `package.json`.

## API

### `init(config)`

Call once at app startup.

```ts
import { init } from "@telemetry-tracker/core";

init({
  ingestUrl: "https://your-api.example.com",  // base URL of the ingest API (no trailing slash)
  app: "my-app",                             // app identifier
  apiKey: "tt_live_<publicId>_<secret>",     // project API key from the dashboard (required in production)
  platform: "web",                            // optional: e.g. "web", "ios", "android"
  environment: "production",                  // optional
  release: "1.2.3",                          // optional
  batchInterval: 5000,                        // optional: ms between flushes (default 5000; 0 = no batching)
  batchSize: 10,                             // optional: flush when queue reaches this size (default 10)
  webVitals: true,                           // optional: capture LCP, INP, CLS, TTFB in browser (default true)
  piiScrub: true,                            // optional: client-side PII scrubbing before send (default off)
});
```

The SDK sends the key as `Authorization: Bearer <apiKey>`. If `apiKey` is omitted and `environment` is not `development`/`dev`/`test`, a console warning is logged.

### `buildIngestHeaders(config)`

Returns `{ "Content-Type": "application/json", Authorization: "Bearer …" }` when `apiKey` is set. Used internally and exported for custom ingest calls (e.g. React Native session payloads).

### `trackEvent(name, properties?)`

Send a named event with optional properties.

```ts
import { trackEvent } from "@telemetry-tracker/core";

trackEvent("button_click", { button: "submit", page: "/checkout" });
```

Events are either sent immediately or queued and sent in batches (see `batchInterval` / `batchSize`).

### `trackError(error, context?)`

Send an error and optional context. The server groups errors by message + first stack line.

```ts
import { trackError } from "@telemetry-tracker/core";

try {
  await doSomething();
} catch (e) {
  trackError(e instanceof Error ? e : new Error(String(e)), { action: "checkout" });
  throw e;
}
```

**In the browser:** After `init()` is called, the core SDK registers global handlers so uncaught errors and unhandled promise rejections are reported automatically: `window.onerror` (sync errors and script load errors) and `window.addEventListener("unhandledrejection", ...)`. These handlers are only installed when running in a real browser environment (they are skipped in React Native and Node, so `init()` is safe to call on all platforms). You can still call `trackError()` manually for caught errors; the same error is only sent once (deduplicated by a flag on the error object).

### `screen(name)`

Record a screen/view (sent as an event with name `$screen` and property `name`). Names starting with `$` are **auto-captured** SDK events; other names are **custom** events in the dashboard.

```ts
import { screen } from "@telemetry-tracker/core";

screen("/home");
screen("Settings");
```

### Web Vitals (browser)

When `webVitals` is not set to `false`, the SDK registers listeners (via the [`web-vitals`](https://github.com/GoogleChrome/web-vitals) library) and sends a **`$web_vital`** auto-captured event for each finalized **LCP**, **INP**, **CLS**, and **TTFB** sample:

```json
{
  "metric": "LCP",
  "value": 2100,
  "rating": "good",
  "path": "/dashboard/overview",
  "id": "v3-…",
  "navigation_type": "navigate",
  "connection_type": "4g"
}
```

Set `webVitals: false` in `init()` to disable. Node and React Native skip vitals automatically.

The dashboard **Performance** page aggregates ingested `$web_vital` samples via `GET /api/performance/summary` (p75/p95, rating distribution, and time series per vital).

### `identify(userId)`

Set the current user id for subsequent events and errors.

```ts
import { identify } from "@telemetry-tracker/core";

identify("user-123");
identify(null);  // clear
```

**Anonymous ID and SDK version:** On first `init()`, the SDK creates a stable **anonymous ID** (UUID), stored in browser `localStorage` or in memory in Node. Every event, error, and session payload includes `anonymous_id` and `sdk_version`. When you call `identify(userId)`, the same anonymous ID is still sent alongside `user_id`, so the backend can link pre-login activity to the user. The dashboard shows a single **Identity** column (user id when set, otherwise anonymous id).

### `getSessionId()` / `endSession()`

On `init()`, the SDK starts an in-memory session and sends `POST /ingest/session`. Events and errors include `session_id`. In browsers, session updates are sent on tab hide/unload via `fetch` with `keepalive`. Call `endSession()` to close explicitly (e.g. on SPA logout).

### `piiScrub` (optional)

Client-side redaction of common PII and secrets before anything is sent. Off by default; `true` uses the defaults, or pass `{ denyKeys: ["ssn", "card"] }` to also redact extra property/context keys (case-insensitive). It complements server-side ingest scrubbing and should never be the only protection. See [PII-SCRUBBING.md](PII-SCRUBBING.md).

### `shutdown()`

Stops ingesting: flushes queued events, clears the batch timer, ends the session and clears the config. Use it in tests, on logout when you want to stop tracking, or before a short-lived process exits. `@telemetry-tracker/next` re-exports it; Node users can import it from `@telemetry-tracker/core`.

### Helpers

- **`getUserId(): string | null`** – Current user id.
- **`getSessionId(): string | null`** – Current session id (from `init()`).
- **`getAnonymousId(): string`** – Anonymous device id (created on first `init()`).
- **`getConfigOrNull(): TelemetryConfig | null`** – Config if `init()` was called.

## Batching

When `batchInterval > 0` (default), `trackEvent` and `screen` are queued and sent in batches to `POST /ingest/batch`. Errors and session payloads are sent immediately. Set `batchInterval: 0` to disable batching and send every event with a single request.

## Usage without a framework package

```ts
import { init, trackEvent, trackError, screen, identify } from "@telemetry-tracker/core";

init({
  ingestUrl: "http://localhost:3001",
  app: "my-app",
  apiKey: process.env.TELEMETRY_API_KEY, // tt_live_… from dashboard
  environment: "development",
});

trackEvent("click", { button: "submit" });
trackError(new Error("Something broke"), { page: "/checkout" });
screen("/home");
identify("user-123");
```

