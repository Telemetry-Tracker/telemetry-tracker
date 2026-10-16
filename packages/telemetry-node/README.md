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
