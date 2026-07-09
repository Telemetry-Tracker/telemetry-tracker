# @telemetry-tracker/vite-plugin

Vite plugin that uploads `.map` files to Telemetry Tracker after production builds so error stacks can be symbolicated in the dashboard.

## Install

```bash
pnpm add -D @telemetry-tracker/vite-plugin
```

## Setup

Enable source maps in Vite and add the plugin to your production build:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { telemetrySourceMaps } from "@telemetry-tracker/vite-plugin";

export default defineConfig({
  build: {
    sourcemap: true,
    outDir: "dist",
  },
  plugins: [
    telemetrySourceMaps({
      apiKey: process.env.TT_API_KEY!,
      projectId: process.env.TT_PROJECT_ID!,
      release: process.env.npm_package_version ?? "dev",
      app: "my-web-app",
      baseUrl: "https://cdn.example.com",
      // baseApiUrl: "https://api.telemetry-tracker.com", // optional; default hosted cloud
      // deleteMapsAfterUpload: true, // remove .map files from dist after upload
      // enabled: process.env.NODE_ENV === "production",
    }),
  ],
});
```

Create a project API key in **Settings → API keys** and store it as `TT_API_KEY`. Use the project UUID from **Settings → General** as `TT_PROJECT_ID`.

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `apiKey` | Yes | Project API key (`tt_live_…`) for CI/build uploads |
| `projectId` | Yes | Project UUID sent as `X-Project-Id` |
| `release` | Yes | Release label (must match SDK `release` on errors) |
| `app` | Yes | App label (must match SDK `app` and key `allowed_app` if set) |
| `baseUrl` | Yes | Public URL prefix for deployed JS bundles (no trailing slash) |
| `baseApiUrl` | No | Telemetry Tracker API origin (default `https://api.telemetry-tracker.com`) |
| `deleteMapsAfterUpload` | No | Delete local `.map` files only after **all** uploads succeed |
| `enabled` | No | When `false`, skip upload (default `true`) |

Uploads run in the `closeBundle` hook after Vite finishes writing assets. Each `.map` file is posted to `POST /api/project/source-maps` with the bundle URL derived from `baseUrl`, Vite’s `base` path, and the file path relative to `build.outDir` (`.map` stripped).

## Self-hosted API

Point `baseApiUrl` at your deployment’s public API URL (same as dashboard `API_URL`, no trailing slash):

```ts
telemetrySourceMaps({
  // ...
  baseApiUrl: "https://telemetry-api.example.com",
});
```

## See also

- [Source maps](./source-maps.md) — API, quotas, symbolication
- [GitHub Action](../.github/actions/upload-source-maps) — CI upload without Vite
