# @telemetry-tracker/node

Node.js SDK: uncaught exceptions, request middleware and cron check-ins. Part of [Telemetry Tracker](https://telemetry-tracker.com), open-source error tracking and product analytics.

## Install

```bash
npm i @telemetry-tracker/node
```

## Quick start

```ts
import { init, middleware, trackError } from "@telemetry-tracker/node";

init({
  ingestUrl: "https://api.telemetry-tracker.com",
  app: "my-backend",
  apiKey: process.env.TELEMETRY_API_KEY,
});

app.use(middleware()); // Express / Connect style (req, res, next)
```

Full guide: [sdk-node.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/sdk-node.md)

License: see the [repository](https://github.com/Telemetry-Tracker/telemetry-tracker).

## Short-lived scripts and jobs

Events are batched. In a cron job, CLI or script, call `await flush()` after the last `trackEvent()` or handled `trackError()`. With Node SDK 1.4.3 and core 1.5.3 or later, it sends queued events and waits for in-flight event batches and handled errors. It never throws and waits at most two seconds; a timeout does not guarantee delivery or cancel pending requests. The SDK also flushes on `beforeExit`, but not after `process.exit()`.

```js
import { init, trackError, flush } from "@telemetry-tracker/node";

init({ ingestUrl: process.env.TELEMETRY_INGEST_URL, app: "nightly-report", apiKey: process.env.TELEMETRY_API_KEY });
try {
  await runReport();
} catch (error) {
  trackError(error, { job: "nightly" });
  await flush();
  process.exit(1);
}
```
