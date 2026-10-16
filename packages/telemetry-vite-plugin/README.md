# @telemetry-tracker/vite-plugin

Uploads Vite build source maps to Telemetry Tracker so stack traces show original files and lines. Part of [Telemetry Tracker](https://telemetry-tracker.com), open-source error tracking and product analytics.

## Install

```bash
npm i -D @telemetry-tracker/vite-plugin
```

## Quick start

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { telemetrySourceMaps } from "@telemetry-tracker/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    telemetrySourceMaps({
      apiKey: process.env.TT_API_KEY!, // CI key with source map upload enabled
      projectId: process.env.TT_PROJECT_ID!,
      release: process.env.npm_package_version ?? "dev",
      app: "my-web-app",
      baseUrl: "https://cdn.example.com",
    }),
  ],
});
```

Full guide: [sdk-vite.md](https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/sdk-vite.md)

License: see the [repository](https://github.com/Telemetry-Tracker/telemetry-tracker).
