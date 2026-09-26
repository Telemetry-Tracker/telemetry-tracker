# @telemetry-tracker/node

Node.js integration: automatic reporting of `uncaughtException` and `unhandledRejection`, plus optional request middleware. Uses `@telemetry-tracker/core` under the hood; all payloads include anonymous id and SDK version (see [telemetry-core](sdk-core.md)).

## Install

In a monorepo workspace:

```bash
pnpm add @telemetry-tracker/node
```

Requires `@telemetry-tracker/core` **^1.5.0** (provides `ingestError` for fatal flushes).

## Setup

Call **`init(config)`** once at process startup (e.g. before starting your HTTP server). This will:

- Initialize the core SDK.
- Register `process.on("uncaughtException")` and `process.on("unhandledRejection")` to report those errors, flush ingest (up to 2s), then exit.

```ts
import { init, trackEvent, trackError } from "@telemetry-tracker/node";

init({
  ingestUrl: "https://your-api.example.com",
  app: "my-backend",
  apiKey: process.env.TELEMETRY_API_KEY,
  platform: "node",  // default
  // exitOnUnhandledRejection: true, // default — report, flush, exit(1)
});
```

## API

| Export | Description |
|--------|-------------|
| `init(config)` | Initialize SDK and install global error handlers. |
| `identify(userId)` | Set current user id (e.g. from request context). |
| `trackEvent(name, properties?)` | Send a named event. |
| `trackError(error, context?)` | Report an error. |
| `getConfig()` | Current config or null. |
| `middleware(opts?)` | Optional generic middleware that tracks `$request` events (method, url, duration). |

Config extends [telemetry-core](sdk-core.md#initconfig) and requires `app`; `platform` defaults to `"node"`.

| Option | Default | Description |
|--------|---------|-------------|
| `exitOnUnhandledRejection` | `true` | After reporting an unhandled rejection, flush and `process.exit(1)` (Node’s default since v15). Set `false` to only report and keep running. |

## Global error handlers

After `init()`:

- **uncaughtException**: Error is reported with `{ source: "uncaughtException" }`, ingest is flushed (≤ 2s), then the process exits with code 1.
- **unhandledRejection**: Reason is reported with `{ source: "unhandledRejection" }`. By default the process then flushes and exits with code 1 (same as Node without the SDK). Set `exitOnUnhandledRejection: false` to keep the legacy “report only” behaviour.

You can still use `trackError` in try/catch for extra context.

## Request middleware

`middleware(opts?)` returns a generic middleware function with signature:

```ts
(req, res, next) => void
```

`duration_ms` is measured from middleware entry until the **response** emits `finish` or `close` (not the request body `end`). `next()` is called exactly once.

Options:

- `trackRequestBody` (default `false`): when true, includes `req.body` in the `$request` event properties (use carefully — may contain PII).

```ts
import { init, middleware } from "@telemetry-tracker/node";

init({ ingestUrl: "...", app: "api" });

const telemetryMiddleware = middleware({ trackRequestBody: false });

// Express
app.use(telemetryMiddleware);
```

For Express you’d typically do `app.use(telemetryMiddleware)` if the middleware calls `next()` and matches Express’ (req, res, next) shape. Our middleware is generic and may need a thin wrapper to match your framework’s expectations. For **NestJS**, see [sdk-nestjs.md](sdk-nestjs.md).
