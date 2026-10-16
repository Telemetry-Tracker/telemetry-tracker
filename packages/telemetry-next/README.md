# @telemetry-tracker/next

Next.js App Router integration: provider, page tracking and error reporting. Part of [Telemetry Tracker](https://telemetry-tracker.com), open-source error tracking and product analytics.

## Install

```bash
npm i @telemetry-tracker/next
```

## Quick start

```tsx
// app/track-page-view.tsx
"use client";
import { usePathname } from "next/navigation";
import { useTrackPage } from "@telemetry-tracker/next";

export function TrackPageView() {
  useTrackPage(usePathname());
  return null;
}

// app/telemetry.tsx ("use client"): wrap your layout's children
// <TelemetryProvider config={{ ingestUrl: "https://api.telemetry-tracker.com", app: "web",
//   apiKey: process.env.NEXT_PUBLIC_TELEMETRY_API_KEY }}><TrackPageView />{children}</TelemetryProvider>
```

Full guide: [sdk-next.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/sdk-next.md)

License: see the [repository](https://github.com/Telemetry-Tracker/telemetry-tracker).
