"use client";

import { useState } from "react";
import Link from "next/link";
import { SectionHeading } from "./features";

type Sdk = {
  id: string;
  label: string;
  install: string;
  code: string;
  docHref: string;
};

const sdks: Sdk[] = [
  {
    id: "next",
    label: "Next.js",
    install: "pnpm add @telemetry-tracker/next",
    docHref: "/error-tracking/nextjs",
    code: `// app/layout.tsx
import { TelemetryProvider } from "@telemetry-tracker/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <TelemetryProvider
      config={{
        ingestUrl: process.env.NEXT_PUBLIC_TELEMETRY_INGEST_URL ?? "",
        app: process.env.NEXT_PUBLIC_TELEMETRY_APP ?? "my-next-app",
        apiKey: process.env.NEXT_PUBLIC_TELEMETRY_API_KEY,
      }}
    >
      {children}
    </TelemetryProvider>
  );
}`,
  },
  {
    id: "node",
    label: "Node.js",
    install: "pnpm add @telemetry-tracker/node",
    docHref: "/error-tracking/nodejs",
    code: `import { init, middleware } from "@telemetry-tracker/node";

init({
  ingestUrl: process.env.TELEMETRY_INGEST_URL!,
  app: "my-api",
  apiKey: process.env.TELEMETRY_API_KEY,
});

app.use(middleware());`,
  },
  {
    id: "nestjs",
    label: "NestJS",
    install: "pnpm add @telemetry-tracker/node",
    docHref: "/docs/nestjs",
    code: `import { NestFactory } from "@nestjs/core";
import { init } from "@telemetry-tracker/node";

async function bootstrap() {
  init({
    ingestUrl: process.env.TELEMETRY_INGEST_URL!,
    app: "my-nest-api",
    apiKey: process.env.TELEMETRY_API_KEY,
  });
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}`,
  },
  {
    id: "nuxt",
    label: "Nuxt",
    install: "pnpm add @telemetry-tracker/core",
    docHref: "/docs/nuxt",
    code: `// plugins/telemetry.client.ts
import { init } from "@telemetry-tracker/core";

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  init({
    ingestUrl: config.public.telemetryIngestUrl,
    app: config.public.telemetryApp,
    apiKey: config.public.telemetryApiKey,
  });
});`,
  },
  {
    id: "vue",
    label: "Vue",
    install: "pnpm add @telemetry-tracker/core",
    docHref: "/docs/vue",
    code: `import { createApp } from "vue";
import { init, screen } from "@telemetry-tracker/core";
import router from "./router";

init({
  ingestUrl: import.meta.env.VITE_TELEMETRY_INGEST_URL,
  app: "my-vue-app",
  apiKey: import.meta.env.VITE_TELEMETRY_API_KEY,
});

router.afterEach((to) => screen(to.fullPath));
createApp(App).use(router).mount("#app");`,
  },
  {
    id: "web",
    label: "Web / React",
    install: "pnpm add @telemetry-tracker/core",
    docHref: "/error-tracking/react",
    code: `import { init, trackEvent } from "@telemetry-tracker/core";

init({
  ingestUrl: import.meta.env.VITE_TELEMETRY_INGEST_URL,
  app: "web",
  apiKey: import.meta.env.VITE_TELEMETRY_API_KEY,
});

trackEvent("button_click", { id: "submit" });`,
  },
  {
    id: "rn",
    label: "React Native",
    install: "pnpm add @telemetry-tracker/react-native",
    docHref: "/error-tracking/react-native",
    code: `import { init } from "@telemetry-tracker/react-native";

init({
  ingestUrl: Config.TELEMETRY_INGEST_URL,
  app: "mobile",
  apiKey: Config.TELEMETRY_API_KEY,
  platform: "react-native",
});`,
  },
];

export function Sdks() {
  const [active, setActive] = useState<Sdk>(sdks[0]!);
  return (
    <section id="sdks" className="relative scroll-mt-28 py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="SDKs"
          title={<>Drop-in for the stack you already use.</>}
          subtitle="Lightweight clients for Next.js, Node, NestJS, Nuxt, Vue, React Native, and the web — one ingest API, consistent payloads."
        />

        <div className="mt-12 rounded-2xl border border-border bg-surface/40">
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background/40 p-1.5">
            {sdks.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s)}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  active.id === s.id
                    ? "bg-surface-elevated text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
            <div className="tabular ml-auto hidden items-center gap-2 pr-2 text-xs text-muted-foreground sm:flex">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />v1.3.0
            </div>
          </div>

          <div className="grid min-w-0 gap-px bg-border md:grid-cols-[1fr_1.4fr]">
            <div className="min-w-0 bg-background p-6">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Install</p>
              <pre className="code-scroll mt-3 rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-[13px] text-foreground">
                <code>{active.install}</code>
              </pre>
              <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Highlights
              </p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {[
                  "Events, errors & sessions",
                  "Batch ingest support",
                  "Anonymous + user ids",
                  "Self-hosted endpoint",
                ].map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5 text-brand"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 8.5 6.5 12 13 4.5" />
                    </svg>
                    {h}
                  </li>
                ))}
              </ul>
              <Link href={active.docHref} className="mt-6 inline-block text-sm text-brand hover:underline">
                View {active.label} setup →
              </Link>
            </div>
            <div className="min-w-0 bg-background p-0">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
                <span className="font-mono">{active.id}.example.ts</span>
              </div>
              <pre className="code-scroll p-5 font-mono text-[13px] leading-relaxed text-foreground/90">
                <code>{active.code}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
