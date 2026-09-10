import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "SDK",
  description: "init(), events, identity, and app naming for Telemetry Tracker SDKs",
  alternates: { canonical: "./" },
};

const FULL_EXAMPLE = `import { init, trackEvent, trackError, screen, identify } from "@telemetry-tracker/core";

init({
  ingestUrl: "https://your-api.example.com",
  app: "my-app",
  apiKey: "tt_live_<publicId>_<secret>",
});

trackEvent("button_click", { id: "submit" });
trackError(new Error("Something broke"), { page: "/checkout" });
screen("/home");
identify("user-123");`;

export default function DocsSdkPage() {
  return (
    <DocsArticle
      title="SDK"
      lede={
        <p>
          The core library (<code>@telemetry-tracker/core</code>) exposes <code>init</code>, event and
          error helpers, screen/session tracking, and identity. Platform packages wrap the same
          config for Next.js, NestJS, Nuxt, Vue, Node, and React Native.
        </p>
      }
    >
      <section className="mb-10" aria-labelledby="sdk-init-heading">
        <h2 id="sdk-init-heading">init(config)</h2>
        <p>
          Required: <code>ingestUrl</code> (your API base URL), <code>app</code> (a string that
          groups data in the dashboard). Optional: <code>platform</code>, <code>environment</code>,{" "}
          <code>release</code>, <code>batchInterval</code>, <code>batchSize</code>,{" "}
          <code>piiScrub</code>.
        </p>
        <p>
          Set <code>piiScrub: true</code> or pass{" "}
          <code>{`{ denyKeys: ["nationalId"] }`}</code> to redact common PII in event properties
          and error payloads <strong>before</strong> send. Client scrubbing is optional and does
          not replace server-side ingest scrubbing. See the{" "}
          <a href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/PII-SCRUBBING.md">
            PII scrubbing guide
          </a>
          .
        </p>
        <CodeBlock
          caption="Full example (after init)"
          code={FULL_EXAMPLE}
          lang="typescript"
        />
      </section>

      <section className="mb-10" aria-labelledby="sdk-identity-heading">
        <h2 id="sdk-identity-heading">Identity and anonymous ID</h2>
        <p>
          The SDK generates a stable anonymous device id on first <code>init()</code> and sends it
          (and the SDK version) with every payload. When you call <code>identify(userId)</code>, the
          same anonymous id is still sent so the backend can link pre-login activity to the user. In
          the dashboard, <strong>Identity</strong> shows the user id when set, otherwise the
          anonymous id.
        </p>
      </section>

      <section className="mb-10" aria-labelledby="sdk-app-heading">
        <h2 id="sdk-app-heading">App name</h2>
        <p>
          The <code>app</code> value identifies your application in filters and lists. You do not
          register apps in the UI—once you send at least one event or error with a name, it appears
          everywhere that supports app filtering.
        </p>
      </section>

      <section aria-labelledby="sdk-next-heading">
        <h2 id="sdk-next-heading">Next steps</h2>
        <p>
          Follow a{" "}
          <Link href="/docs" className="text-link font-medium">
            platform guide
          </Link>{" "}
          for install steps, or open the{" "}
          <Link href="/docs/dashboard" className="text-link font-medium">
            dashboard
          </Link>{" "}
          docs to learn how data appears in the UI.
        </p>
      </section>

      <DocsAlsoSee
        links={[
          { href: "/error-tracking/react", label: "React error tracking guide" },
          { href: "/error-tracking/nextjs", label: "Next.js error tracking" },
          { href: "/docs/hosted-cloud", label: "Hosted cloud getting started" },
        ]}
      />
    </DocsArticle>
  );
}
