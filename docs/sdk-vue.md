# Vue 3

Browser integration for Vue 3 SPAs with **vue-router**. Uses `@telemetry-tracker/core` directly (no separate npm package). For Nuxt, see [sdk-nuxt.md](sdk-nuxt.md).

## Install

```bash
pnpm add @telemetry-tracker/core
```

## Vite environment

```env
VITE_TELEMETRY_INGEST_URL=https://your-api.example.com
VITE_TELEMETRY_APP=my-vue-app
VITE_TELEMETRY_API_KEY=tt_live_<publicId>_<secret>
```

## Setup

Initialize in `main.ts` before mounting, then track route changes:

```ts
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { init, installVueErrorHandler, screen } from "@telemetry-tracker/core";

init({
  ingestUrl: import.meta.env.VITE_TELEMETRY_INGEST_URL,
  app: import.meta.env.VITE_TELEMETRY_APP ?? "my-vue-app",
  apiKey: import.meta.env.VITE_TELEMETRY_API_KEY,
  platform: "web",
  environment: import.meta.env.MODE,
});

router.afterEach((to) => {
  screen(to.fullPath || "/");
});

const app = createApp(App);
installVueErrorHandler(app); // component errors (render, hooks, event handlers)
app.use(router).mount("#app");
```

## Component errors

Vue catches errors thrown in render functions, lifecycle hooks, watchers and event handlers (including async ones) and passes them to `app.config.errorHandler`; in production builds they otherwise only reach `console.error` and never `window.onerror`. `installVueErrorHandler(app)` (core 1.6.0+) reports them with `context.source = "vue"`, the component name and Vue's `info`. An existing `errorHandler` is chained (install yours first); without one, the error is still logged to the console.

## API

Same as [telemetry-core](sdk-core.md): `init`, `installVueErrorHandler`, `trackEvent`, `trackError`, `screen`, `identify`, `getSessionId`, `endSession`.

After `init()`, the core SDK registers `window.onerror` and `unhandledrejection` in the browser.

## Hosted cloud

Point `ingestUrl` at `https://api.telemetry-tracker.com` and use an API key from [telemetry-tracker.com](https://telemetry-tracker.com). See the dashboard guide at `/docs/hosted-cloud`.

## Source maps (Vite)

Enable `build.sourcemap: true` and add `@telemetry-tracker/vite-plugin` so production stacks symbolicate in the dashboard. Full options: [source-maps.md](./source-maps.md#vite-plugin).

```ts
// vite.config.ts
import { telemetrySourceMaps } from "@telemetry-tracker/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    telemetrySourceMaps({
      apiKey: process.env.TT_API_KEY!,
      projectId: process.env.TT_PROJECT_ID!,
      release: process.env.TT_RELEASE!,
      app: import.meta.env.VITE_TELEMETRY_APP ?? "my-vue-app",
      baseUrl: "https://your-cdn.example.com",
    }),
  ],
});
```
