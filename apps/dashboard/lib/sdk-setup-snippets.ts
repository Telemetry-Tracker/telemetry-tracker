import { HOSTED_API_URL } from "@/lib/hosted-cloud";

/**
 * Install and setup snippets reused on acquisition landing pages.
 * Kept in sync with the platform docs (hosted ingest URL for the free-cloud path).
 */
export const nextInstall = `pnpm add @telemetry-tracker/next
# or
npm install @telemetry-tracker/next`;

export const nextProviderSetup = `// app/layout.tsx
import { TelemetryProvider } from "@telemetry-tracker/next";
import { TrackPageView } from "./track-page-view";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TelemetryProvider
          config={{
            ingestUrl: process.env.NEXT_PUBLIC_TELEMETRY_INGEST_URL ?? "${HOSTED_API_URL}",
            app: process.env.NEXT_PUBLIC_TELEMETRY_APP ?? "my-next-app",
            apiKey: process.env.NEXT_PUBLIC_TELEMETRY_API_KEY,
          }}
        >
          <TrackPageView />
          {children}
        </TelemetryProvider>
      </body>
    </html>
  );
}`;

export const nextTrackPageView = `// app/track-page-view.tsx
"use client";

import { usePathname } from "next/navigation";
import { useTrackPage } from "@telemetry-tracker/next";

export function TrackPageView() {
  const pathname = usePathname();
  useTrackPage(pathname);
  return null;
}`;

export const nextErrorBoundary = `import { TelemetryErrorBoundary } from "@telemetry-tracker/next";

<TelemetryErrorBoundary fallback={<div>Something went wrong</div>}>
  <YourComponent />
</TelemetryErrorBoundary>`;

export const nextTestError = `import { trackError } from "@telemetry-tracker/next";

trackError(new Error("Test error from Next.js"), { page: "/" });`;

export const reactInstall = `pnpm add @telemetry-tracker/core
# or
npm install @telemetry-tracker/core`;

export const reactSetup = `import { init, trackEvent, trackError, screen, identify } from "@telemetry-tracker/core";

init({
  ingestUrl: "${HOSTED_API_URL}",
  app: "my-app",
  apiKey: "tt_live_<publicId>_<secret>",
});

trackEvent("button_click", { id: "submit" });
trackError(new Error("Something broke"), { page: "/checkout" });
screen("/home");
identify("user-123");`;

export const reactTestError = `import { trackError } from "@telemetry-tracker/core";

trackError(new Error("Test error from React"), { page: "/" });`;

export const nodeInstall = `pnpm add @telemetry-tracker/node
# or
npm install @telemetry-tracker/node`;

export const nodeSetup = `import { init, trackEvent, trackError } from "@telemetry-tracker/node";

init({
  ingestUrl: process.env.TELEMETRY_INGEST_URL || "${HOSTED_API_URL}",
  app: "my-api",
  apiKey: process.env.TELEMETRY_API_KEY,
  platform: "node",
});

trackEvent("server_started", { version: "1.0.0" });
trackError(new Error("DB connection failed"), { db: "primary" });`;

export const nodeMiddleware = `import { middleware } from "@telemetry-tracker/node";

const telemetryMiddleware = middleware({ trackRequestBody: false });

// Express-style
app.use((req, res, next) => {
  telemetryMiddleware(req, res, () => {
    next();
  });
});`;

export const nodeTestError = `import { trackError } from "@telemetry-tracker/node";

trackError(new Error("Test error from Node.js"), { route: "/health" });`;

export const reactNativeInstall = `pnpm add @telemetry-tracker/react-native
# or
npm install @telemetry-tracker/react-native`;

export const reactNativeSetup = `import { Platform } from "react-native";
import Constants from "expo-constants";
import { init } from "@telemetry-tracker/react-native";

init({
  ingestUrl: "${HOSTED_API_URL}",
  app: "my-rn-app",
  apiKey: "tt_live_<publicId>_<secret>",
  platform: Platform.OS === "web" ? "web" : Platform.OS,
  environment: __DEV__ ? "development" : "production",
  release: Constants.expoConfig?.version ?? "1.0.0",
});`;

export const reactNativeTestError = `import { trackError } from "@telemetry-tracker/react-native";

trackError(new Error("Test error from React Native"), { screen: "Home" });`;

export const reactNativeScreen = `import { screen } from "@telemetry-tracker/react-native";

screen("Home");
screen("Profile");`;
