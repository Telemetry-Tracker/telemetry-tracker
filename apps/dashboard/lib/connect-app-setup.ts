import { HOSTED_API_URL } from "@/lib/hosted-cloud";
import { buildNextEnvLocal, nextInstall, nextProviderSetup } from "@/lib/sdk-setup-snippets";

export const CONNECT_APP_FRAMEWORKS = [
  { id: "nextjs", label: "Next.js", docsHref: "/docs/nextjs" },
  { id: "node", label: "Node.js", docsHref: "/docs/node" },
  { id: "react", label: "React", docsHref: "/error-tracking/react" },
  { id: "react-native", label: "React Native", docsHref: "/docs/react-native" },
  { id: "vue", label: "Vue", docsHref: "/docs/vue" },
  { id: "nuxt", label: "Nuxt", docsHref: "/docs/nuxt" },
  { id: "nestjs", label: "NestJS", docsHref: "/docs/nestjs" },
  { id: "other", label: "Other / generic SDK", docsHref: "/docs/sdk" },
] as const;

export type ConnectAppFrameworkId = (typeof CONNECT_APP_FRAMEWORKS)[number]["id"];

export function frameworkLabel(id: string | null | undefined): string {
  return CONNECT_APP_FRAMEWORKS.find((f) => f.id === id)?.label ?? "SDK";
}

export function frameworkDocsHref(id: string | null | undefined): string {
  return CONNECT_APP_FRAMEWORKS.find((f) => f.id === id)?.docsHref ?? "/docs/sdk";
}

export type ConnectAppSnippets = {
  install: string;
  env: string;
  init: string;
  verify: string;
  /** Longer reference (layout + provider). Collapsed by default in the UI. */
  fullExample: string | null;
};

/** Short install + init snippets for the connect wizard (not a substitute for full docs). */
export function connectAppSnippets(
  framework: string | null | undefined,
  opts: { appName: string; apiKey?: string | null }
): ConnectAppSnippets {
  const app = opts.appName || "my-app";
  const key = opts.apiKey?.trim() || "tt_live_<publicId>_<secret>";
  const ingest = HOSTED_API_URL;

  if (framework === "nextjs") {
    const env = opts.apiKey
      ? buildNextEnvLocal(key, app)
      : `# .env.local
NEXT_PUBLIC_TELEMETRY_INGEST_URL=${ingest}
NEXT_PUBLIC_TELEMETRY_API_KEY=${key}
NEXT_PUBLIC_TELEMETRY_APP=${app}`;
    return {
      install: nextInstall,
      env,
      init: `// app/layout.tsx (or providers.tsx)
import { TelemetryProvider } from "@telemetry-tracker/next";

<TelemetryProvider
  config={{
    ingestUrl: process.env.NEXT_PUBLIC_TELEMETRY_INGEST_URL!,
    app: process.env.NEXT_PUBLIC_TELEMETRY_APP!,
    apiKey: process.env.NEXT_PUBLIC_TELEMETRY_API_KEY,
  }}
>
  {children}
</TelemetryProvider>`,
      verify: `import { trackEvent } from "@telemetry-tracker/next";

trackEvent("app_connected");`,
      fullExample: nextProviderSetup,
    };
  }

  if (framework === "node" || framework === "nestjs") {
    const pkg =
      framework === "nestjs"
        ? `pnpm add @telemetry-tracker/node\n# Also register TelemetryInterceptor — see /docs/nestjs`
        : `pnpm add @telemetry-tracker/node`;
    return {
      install: pkg,
      env: `# .env
TELEMETRY_INGEST_URL=${ingest}
TELEMETRY_API_KEY=${key}
TELEMETRY_APP=${app}`,
      init: `import { init } from "@telemetry-tracker/node";

init({
  ingestUrl: process.env.TELEMETRY_INGEST_URL ?? "${ingest}",
  app: process.env.TELEMETRY_APP ?? "${app}",
  apiKey: process.env.TELEMETRY_API_KEY ?? "${key}",
});`,
      verify: `import { trackEvent } from "@telemetry-tracker/node";

trackEvent("app_connected");`,
      fullExample: null,
    };
  }

  if (framework === "react-native") {
    return {
      install: `pnpm add @telemetry-tracker/react-native`,
      env: `# Keep secrets out of the JS bundle when possible (e.g. EAS secrets).
TELEMETRY_INGEST_URL=${ingest}
TELEMETRY_API_KEY=${key}
TELEMETRY_APP=${app}`,
      init: `import { init } from "@telemetry-tracker/react-native";

init({
  ingestUrl: "${ingest}",
  app: "${app}",
  apiKey: "${key}",
});`,
      verify: `import { trackEvent } from "@telemetry-tracker/react-native";

trackEvent("app_connected");`,
      fullExample: null,
    };
  }

  if (framework === "vue" || framework === "nuxt") {
    return {
      install: `pnpm add @telemetry-tracker/core`,
      env: `# .env
VITE_TELEMETRY_INGEST_URL=${ingest}
VITE_TELEMETRY_API_KEY=${key}
VITE_TELEMETRY_APP=${app}`,
      init: `import { init, installVueErrorHandler } from "@telemetry-tracker/core";

const telemetry = init({
  ingestUrl: "${ingest}",
  app: "${app}",
  apiKey: "${key}",
});
installVueErrorHandler(vueApp, telemetry);`,
      verify: `telemetry.trackEvent("app_connected");`,
      fullExample: null,
    };
  }

  if (framework === "react") {
    return {
      install: `pnpm add @telemetry-tracker/core`,
      env: `# .env
VITE_TELEMETRY_INGEST_URL=${ingest}
VITE_TELEMETRY_API_KEY=${key}
VITE_TELEMETRY_APP=${app}`,
      init: `import { init } from "@telemetry-tracker/core";

init({
  ingestUrl: "${ingest}",
  app: "${app}",
  apiKey: "${key}",
});`,
      verify: `import { trackEvent } from "@telemetry-tracker/core";

trackEvent("app_connected");`,
      fullExample: null,
    };
  }

  return {
    install: `pnpm add @telemetry-tracker/core
# or @telemetry-tracker/node / @telemetry-tracker/next`,
    env: `# Environment
TELEMETRY_INGEST_URL=${ingest}
TELEMETRY_API_KEY=${key}
TELEMETRY_APP=${app}`,
    init: `import { init } from "@telemetry-tracker/core";

init({
  ingestUrl: "${ingest}",
  app: "${app}",
  apiKey: "${key}",
});`,
    verify: `import { trackEvent } from "@telemetry-tracker/core";

trackEvent("app_connected");`,
    fullExample: null,
  };
}

export type ConnectWizardStep = "details" | "key" | "install" | "waiting";

/** Pick the best resume step for an already-registered app. */
export function resumeStepForApp(opts: {
  connected: boolean;
  hasActiveKey: boolean;
  viewOnly?: boolean;
}): ConnectWizardStep {
  if (opts.connected || opts.viewOnly) return "install";
  if (!opts.hasActiveKey) return "key";
  return "install";
}

export function connectAppHref(appName?: string | null, view?: boolean): string {
  const base = "/dashboard/apps/connect";
  const params = new URLSearchParams();
  if (appName?.trim()) params.set("app", appName.trim());
  if (view) params.set("view", "1");
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

export type OverviewSetupBannerMode =
  | "none"
  | "project_empty"
  | "finish_setup"
  | "quiet_window";

/**
 * Empty Overview: never-telemetry (finish setup) vs quiet time window vs brand-new project.
 * Prefer `firstEventAt` / `connected` from the ProjectApp registry.
 */
export function resolveOverviewSetupBanner(opts: {
  eventsCount: number;
  errorsCount: number;
  selectedApp?: string | null;
  projectApps: { name: string; connected: boolean; firstEventAt: string | null }[];
}): { mode: OverviewSetupBannerMode; appName: string | null } {
  if (opts.eventsCount > 0 || opts.errorsCount > 0) {
    return { mode: "none", appName: null };
  }

  const selected = opts.selectedApp?.trim() || null;
  if (selected) {
    const row = opts.projectApps.find((a) => a.name === selected);
    if (row?.connected || row?.firstEventAt) {
      return { mode: "quiet_window", appName: selected };
    }
    return { mode: "finish_setup", appName: selected };
  }

  const unfinished = opts.projectApps.find((a) => !a.connected && !a.firstEventAt);
  if (unfinished) {
    return { mode: "finish_setup", appName: unfinished.name };
  }
  if (opts.projectApps.some((a) => a.connected || a.firstEventAt)) {
    return { mode: "quiet_window", appName: null };
  }
  return { mode: "project_empty", appName: null };
}
