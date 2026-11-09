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

/** Short install + init snippets for the connect wizard (not a substitute for full docs). */
export function connectAppSnippets(
  framework: string | null | undefined,
  opts: { appName: string; apiKey?: string | null }
): { install: string; configure: string; verify: string } {
  const app = opts.appName || "my-app";
  const key = opts.apiKey?.trim() || "tt_live_<publicId>_<secret>";
  const ingest = HOSTED_API_URL;

  if (framework === "nextjs") {
    return {
      install: nextInstall,
      configure: opts.apiKey
        ? `${buildNextEnvLocal(key, app)}\n\n${nextProviderSetup}`
        : `# .env.local\nNEXT_PUBLIC_TELEMETRY_INGEST_URL=${ingest}\nNEXT_PUBLIC_TELEMETRY_API_KEY=${key}\nNEXT_PUBLIC_TELEMETRY_APP=${app}\n\n${nextProviderSetup}`,
      verify: `import { trackEvent } from "@telemetry-tracker/next";\n\ntrackEvent("app_connected");`,
    };
  }

  if (framework === "node" || framework === "nestjs") {
    const pkg =
      framework === "nestjs"
        ? `pnpm add @telemetry-tracker/node\n# register TelemetryInterceptor — see /docs/nestjs`
        : `pnpm add @telemetry-tracker/node`;
    return {
      install: pkg,
      configure: `import { init } from "@telemetry-tracker/node";\n\ninit({\n  ingestUrl: "${ingest}",\n  app: "${app}",\n  apiKey: process.env.TELEMETRY_API_KEY ?? "${key}",\n});`,
      verify: `import { trackEvent } from "@telemetry-tracker/node";\n\ntrackEvent("app_connected");`,
    };
  }

  if (framework === "react-native") {
    return {
      install: `pnpm add @telemetry-tracker/react-native`,
      configure: `import { init } from "@telemetry-tracker/react-native";\n\ninit({\n  ingestUrl: "${ingest}",\n  app: "${app}",\n  apiKey: "${key}",\n});`,
      verify: `import { trackEvent } from "@telemetry-tracker/react-native";\n\ntrackEvent("app_connected");`,
    };
  }

  if (framework === "vue" || framework === "nuxt") {
    return {
      install: `pnpm add @telemetry-tracker/core`,
      configure: `import { init, installVueErrorHandler } from "@telemetry-tracker/core";\n\nconst telemetry = init({\n  ingestUrl: "${ingest}",\n  app: "${app}",\n  apiKey: "${key}",\n});\n// pass your Vue app instance:\ninstallVueErrorHandler(vueApp, telemetry);`,
      verify: `telemetry.trackEvent("app_connected");`,
    };
  }

  return {
    install: `pnpm add @telemetry-tracker/core\n# or @telemetry-tracker/node / @telemetry-tracker/next`,
    configure: `import { init } from "@telemetry-tracker/core";\n\ninit({\n  ingestUrl: "${ingest}",\n  app: "${app}",\n  apiKey: "${key}",\n});`,
    verify: `import { trackEvent } from "@telemetry-tracker/core";\n\ntrackEvent("app_connected");`,
  };
}
