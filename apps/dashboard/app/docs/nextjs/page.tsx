import type { Metadata } from "next";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Next.js",
  description: "Integrate Telemetry Tracker with Next.js",
  alternates: { canonical: "./" },
};

export default function DocsNextJsPage() {
  return (
    <DocsArticle
      title="Next.js"
      lede={
        <p>
          Use the <code>@telemetry-tracker/next</code> package for Next.js apps. It provides a
          provider, error boundary, and a hook to track page views. In the browser, uncaught errors
          and unhandled promise rejections are also reported automatically (via core’s global
          handlers after <code>init()</code>).
        </p>
      }
    >
      <h2>Install</h2>
      <CodeBlock
        code={`pnpm add @telemetry-tracker/next
# or
npm install @telemetry-tracker/next`}
      />

      <h2>Setup</h2>
      <p>
        Wrap your app with <code>TelemetryProvider</code> and pass the config. Call{" "}
        <code>useTrackPage(pathname)</code> in your root layout so each route change sends a screen
        event.
      </p>
      <CodeBlock
        code={`// app/layout.tsx
import { TelemetryProvider, useTrackPage } from "@telemetry-tracker/next";

function TrackPageView({ pathname }: { pathname: string }) {
  useTrackPage(pathname);
  return null;
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <TelemetryProvider
          config={{
            ingestUrl: process.env.NEXT_PUBLIC_TELEMETRY_INGEST_URL ?? "",
            app: process.env.NEXT_PUBLIC_TELEMETRY_APP ?? "my-next-app",
          }}
        >
          <TrackPageView pathname={/* get pathname from usePathname() */} />
          {children}
        </TelemetryProvider>
      </body>
    </html>
  );
}`}
      />

      <p>
        For the pathname you need a client component that uses <code>usePathname()</code> from{" "}
        <code>next/navigation</code> and passes it to <code>useTrackPage(pathname)</code>.
      </p>

      <h2>Errors</h2>
      <p>
        After <code>TelemetryProvider</code> calls <code>init()</code>, uncaught sync errors and
        unhandled promise rejections in the browser are sent automatically. For React render errors,
        wrap parts of your tree with <code>TelemetryErrorBoundary</code> to report them (and
        optionally show a fallback).
      </p>
      <CodeBlock
        code={`import { TelemetryErrorBoundary } from "@telemetry-tracker/next";

<TelemetryErrorBoundary fallback={<div>Something went wrong</div>}>
  <YourComponent />
</TelemetryErrorBoundary>`}
      />

      <h2>Custom events and identify</h2>
      <p>
        Import <code>trackEvent</code>, <code>screen</code>, and <code>identify</code> from{" "}
        <code>@telemetry-tracker/next</code> when needed.
      </p>
      <CodeBlock
        code={`import { trackEvent, screen, identify } from "@telemetry-tracker/next";

trackEvent("signup_clicked", { source: "hero" });
screen("/settings");
identify(user.id);  // after login
identify(null);     // on logout`}
      />

      <DocsAlsoSee
        links={[
          { href: "/error-tracking/nextjs", label: "Next.js error tracking guide" },
          { href: "/error-tracking/react", label: "React error tracking" },
          { href: "/docs/hosted-cloud", label: "Hosted cloud getting started" },
        ]}
      />
    </DocsArticle>
  );
}
