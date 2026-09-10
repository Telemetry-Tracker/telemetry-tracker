import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Node.js",
  description: "Integrate Telemetry Tracker with Node.js",
  alternates: { canonical: "./" },
};

export default function DocsNodePage() {
  return (
    <DocsArticle
      title="Node.js"
      lede={
        <p>
          Use the <code>@telemetry-tracker/node</code> package for Node.js servers. It wraps{" "}
          <code>@telemetry-tracker/core</code> and installs global handlers for{" "}
          <code>uncaughtException</code> and <code>unhandledRejection</code>. All payloads include
          anonymous id and SDK version. You can also attach a request middleware to track HTTP
          requests.
        </p>
      }
    >
      <h2>Install</h2>
      <CodeBlock
        code={`pnpm add @telemetry-tracker/node
# or
npm install @telemetry-tracker/node`}
      />

      <h2>Setup</h2>
      <p>
        Call <code>init()</code> as early as possible (e.g. at the top of your entry file):
      </p>
      <CodeBlock
        code={`import { init, trackEvent, trackError } from "@telemetry-tracker/node";

init({
  ingestUrl: process.env.TELEMETRY_INGEST_URL || "https://your-api.example.com",
  app: "my-api",
  apiKey: process.env.TELEMETRY_API_KEY,
  platform: "node",
});

trackEvent("server_started", { version: "1.0.0" });
trackError(new Error("DB connection failed"), { db: "primary" });`}
      />

      <h2>Global error handlers</h2>
      <p>
        After <code>init()</code>, <code>uncaughtException</code> and{" "}
        <code>unhandledRejection</code> are patched to send errors to the ingest API (and then
        rethrow / continue so your process can still exit or log as usual).
      </p>

      <h2>Request middleware</h2>
      <p>
        Optional: use <code>middleware()</code> to send a <code>$request</code> event per HTTP
        request (method, url, duration). Attach it to your server framework (Express, Fastify,
        NestJS, etc.) so it runs for each request.
      </p>
      <CodeBlock
        code={`import { middleware } from "@telemetry-tracker/node";

const telemetryMiddleware = middleware({ trackRequestBody: false });

// Express-style
app.use((req, res, next) => {
  telemetryMiddleware(req, res, () => {
    next();
  });
});

// Or call next() and then track when response finishes — adapt to your framework.`}
      />

      <p>
        The middleware tracks <code>method</code>, <code>url</code>, and <code>duration_ms</code>.
        Set <code>trackRequestBody: true</code> to include the request body in the event (use with
        care for PII/size). For NestJS, see the{" "}
        <Link href="/docs/nestjs" className="text-brand hover:underline">
          NestJS guide
        </Link>
        .
      </p>

      <DocsAlsoSee
        links={[
          { href: "/error-tracking/nodejs", label: "Node.js error tracking guide" },
          { href: "/docs/nestjs", label: "NestJS docs" },
          { href: "/self-hosted-error-tracking", label: "Self-hosted error tracking" },
        ]}
      />
    </DocsArticle>
  );
}
