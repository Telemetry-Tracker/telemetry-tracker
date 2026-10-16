# @telemetry-tracker/core

Framework-agnostic browser/Node SDK: events, errors, sessions and Web Vitals. Part of [Telemetry Tracker](https://telemetry-tracker.com), open-source error tracking and product analytics.

## Install

```bash
npm i @telemetry-tracker/core
```

## Quick start

```ts
import { init, trackEvent, trackError } from "@telemetry-tracker/core";

init({
  ingestUrl: "https://api.telemetry-tracker.com",
  app: "my-app",
  apiKey: "tt_live_<publicId>_<secret>",
});

trackEvent("signup", { plan: "free" });
trackError(new Error("Something failed"));
```

Full guide: [sdk-core.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/sdk-core.md)

License: see the [repository](https://github.com/Telemetry-Tracker/telemetry-tracker).
