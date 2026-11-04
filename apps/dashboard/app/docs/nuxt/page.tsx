import type { Metadata } from "next";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Nuxt",
  description: "Integrate Telemetry Tracker with Nuxt",
  alternates: { canonical: "./" },
};

export default function DocsNuxtPage() {
  return (
    <DocsArticle
      title="Nuxt"
      lede={
        <p>
          Nuxt is Vue-based, so use <code>@telemetry-tracker/core</code> directly (there is no
          telemetry-nuxt package). Add a client plugin to init and a global middleware to track page
          views. After <code>init()</code>, uncaught errors and unhandled promise rejections in the
          browser are reported automatically, and <code>installVueErrorHandler()</code> reports
          errors thrown inside components.
        </p>
      }
    >
      <h2>Install</h2>
      <CodeBlock
        code={`pnpm add @telemetry-tracker/core
# or
npm install @telemetry-tracker/core`}
      />

      <h2>Runtime config</h2>
      <p>
        In <code>nuxt.config.ts</code> expose the ingest URL, app name, and API key:
      </p>
      <CodeBlock
        code={`export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      telemetryIngestUrl: process.env.NUXT_PUBLIC_TELEMETRY_INGEST_URL || "https://your-api.example.com",
      telemetryApp: process.env.NUXT_PUBLIC_TELEMETRY_APP || "my-nuxt-app",
      telemetryApiKey: process.env.NUXT_PUBLIC_TELEMETRY_API_KEY || "",
    },
  },
});`}
      />

      <h2>Where the files go</h2>
      <p>
        Nuxt 4 reads plugins and route middleware from the <code>app/</code> source directory:{" "}
        <code>app/plugins/</code> and <code>app/middleware/</code>. Files in a root{" "}
        <code>plugins/</code> or <code>middleware/</code> folder are ignored, so nothing is sent.
        On Nuxt 3 (or Nuxt 4 with <code>srcDir: &quot;.&quot;</code>), use{" "}
        <code>plugins/</code> and <code>middleware/</code> at the project root instead. The file
        contents are the same.
      </p>

      <h2>Plugin (client-only)</h2>
      <p>
        Create <code>app/plugins/telemetry.client.ts</code> (Nuxt 3:{" "}
        <code>plugins/telemetry.client.ts</code>):
      </p>
      <CodeBlock
        code={`import { init, installVueErrorHandler } from "@telemetry-tracker/core";

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  init({
    ingestUrl: config.public.telemetryIngestUrl as string,
    app: config.public.telemetryApp as string,
    apiKey: config.public.telemetryApiKey as string,
    platform: "web",
    environment: import.meta.dev ? "development" : "production",
  });
  // Report errors thrown inside components (Vue catches them before window.onerror).
  installVueErrorHandler(nuxtApp.vueApp);
});`}
      />

      <h2>Page tracking</h2>
      <p>
        Create <code>app/middleware/telemetry.global.ts</code> (Nuxt 3:{" "}
        <code>middleware/telemetry.global.ts</code>) to send a screen event on each route:
      </p>
      <CodeBlock
        code={`import { screen } from "@telemetry-tracker/core";

export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.client) {
    screen(to.path || "/");
  }
});`}
      />

      <h2>Custom events and errors</h2>
      <CodeBlock
        code={`import { trackEvent, trackError } from "@telemetry-tracker/core";

trackEvent("button_click", { id: "submit" });
trackError(new Error("Something broke"), { page: "/checkout" });`}
      />

      <p>
        Core registers <code>window.onerror</code> and <code>unhandledrejection</code> after{" "}
        <code>init()</code>, so uncaught errors and promise rejections are reported automatically;
        component errors are reported by <code>installVueErrorHandler()</code> (core 1.6.0+).
        Use <code>trackError()</code> in try/catch for extra context.
      </p>

      <h2>Optional: identify user</h2>
      <CodeBlock
        code={`import { identify } from "@telemetry-tracker/core";

identify(user.id);  // after login
identify(null);     // on logout`}
      />
    </DocsArticle>
  );
}
