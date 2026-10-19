import type { Metadata } from "next";
import Link from "next/link";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "SDK data & privacy labels",
  description:
    "What the browser and React Native SDKs collect and send, for Apple App Privacy and Google Play Data safety forms.",
  alternates: { canonical: "./" },
};

function ClaimTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border align-top">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground/85">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsSdkPrivacyPage() {
  return (
    <DocsArticle
      title="SDK data & privacy labels"
      lede={
        <p>
          This page describes what our browser and React Native SDKs send to ingest, based on the
          current open-source packages. Use it when you fill in Apple App Privacy or Google Play
          Data safety forms. It is not a legal opinion, a DPA, or a guarantee that every string is
          free of personal data.
        </p>
      }
    >
      <h2>Scope</h2>
      <ul>
        <li>
          Browser / Next.js: <code>@telemetry-tracker/core</code> and{" "}
          <code>@telemetry-tracker/next</code>
        </li>
        <li>
          React Native: <code>@telemetry-tracker/react-native</code> (wraps core; JavaScript errors
          only)
        </li>
      </ul>
      <p>
        Server-side Node and NestJS packages use the same ingest fields for errors and events, but
        do not install browser Web Vitals or <code>localStorage</code> anonymous ids. Native iOS /
        Android crash reporters are not part of these SDKs.
      </p>

      <h2>Transport</h2>
      <ul>
        <li>
          Base URL is your configured <code>ingestUrl</code>. Paths:{" "}
          <code>/ingest/error</code>, <code>/ingest/event</code>, <code>/ingest/batch</code>,{" "}
          <code>/ingest/session</code>.
        </li>
        <li>
          JSON body over HTTPS in production. Auth header:{" "}
          <code>Authorization: Bearer tt_live_…</code> (or <code>X-API-Key</code>). No cookies.
        </li>
        <li>
          The client does not put the visitor IP in the payload. Hosted ingest may see the
          connection IP for rate limiting only; error, event and session rows do not store an IP
          column.
        </li>
      </ul>

      <h2>Identifiers and storage</h2>
      <ClaimTable
        headers={["Field", "When", "Notes"]}
        rows={[
          [
            "anonymous_id",
            "Always after init",
            "Random UUID. In browsers, stored under localStorage key tacko_telemetry_anon_id. On React Native / Node, kept in memory only.",
          ],
          [
            "session_id",
            "Each session started by init",
            "Random UUID sent on session and error/event envelopes.",
          ],
          [
            "user_id",
            "Only if you call identify(id)",
            "Optional. Cleared with identify(null).",
          ],
          [
            "user_email",
            "Only if you call identify(id, { email })",
            "Optional. Not sent unless your app passes it.",
          ],
          [
            "sdk_version",
            "Every ingest call",
            "Package version string.",
          ],
        ]}
      />

      <h2>Error reports</h2>
      <p>Typical fields on <code>POST /ingest/error</code>:</p>
      <ul>
        <li>
          <code>message</code>, optional <code>stack</code>, optional <code>context</code>
        </li>
        <li>
          Envelope: <code>app</code>, optional <code>platform</code>, <code>environment</code>,{" "}
          <code>release</code>, <code>anonymous_id</code>, <code>sdk_version</code>, optional{" "}
          <code>user_id</code> / <code>session_id</code>
        </li>
      </ul>
      <p>
        Auto-capture: browsers install <code>window.onerror</code> and{" "}
        <code>unhandledrejection</code>; React Native installs an <code>ErrorUtils</code> global
        handler. There are <strong>no breadcrumbs</strong> and <strong>no session replay</strong> in
        these SDKs. Request headers and bodies are not forwarded by the browser SDK.
      </p>

      <h2>Sessions and device hints</h2>
      <p>
        Sessions may include <code>device_browser</code> and <code>device_os</code> (parsed from the
        user agent family, not a full UA string) and <code>country</code> derived from the runtime
        locale (for example <code>en-US</code> → <code>US</code>). That is not GPS or precise
        location. React Native does not add device model or manufacturer fields.
      </p>

      <h2>Events and Web Vitals</h2>
      <p>
        Named events and <code>$screen</code> / page helpers send a name plus optional properties
        you supply. In browsers, Core Web Vitals (LCP, INP, CLS, TTFB) are on by default unless you
        set <code>webVitals: false</code>. The React Native package does not install Web Vitals.
      </p>

      <h2>React Native permissions</h2>
      <p>
        <code>@telemetry-tracker/react-native</code> is JavaScript-only (depends on core; peer{" "}
        <code>react-native</code>). It does not ship an AndroidManifest, Info.plist change, or
        native module, so it adds <strong>no OS permissions</strong> of its own. Network access
        comes from your app.
      </p>

      <h2>Scrubbing (read carefully)</h2>
      <ul>
        <li>
          <strong>Server ingest scrubbing</strong> is on by default and is{" "}
          <strong>best-effort</strong> pattern and key redaction. Self-hosters can disable it with{" "}
          <code>TELEMETRY_INGEST_PII_SCRUB=false</code>. See the{" "}
          <a href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/PII-SCRUBBING.md">
            PII scrubbing reference
          </a>
          .
        </li>
        <li>
          <strong>Client <code>piiScrub</code></strong> is <strong>opt-in</strong> (off when
          omitted). It redacts common secrets and some sensitive query <em>parameter names</em>; it
          does <strong>not</strong> strip all query strings.
        </li>
        <li>
          The Next.js server helper <code>createOnRequestError</code> strips query strings from the
          path and does not copy request headers. That behaviour is specific to that helper.
        </li>
      </ul>
      <p>
        Do not treat scrubbing as a complete removal of personal data. Free-form error messages and
        stacks can still contain identifiers your app puts there.
      </p>

      <h2>Apple App Privacy (proposed mapping)</h2>
      <p>
        These are suggested answers for forms that ask what a crash / diagnostics SDK collects.
        Adjust for how <em>your</em> app calls <code>identify</code>, custom events, and Web Vitals.
        We do not claim “no data collected” or “tracking” one way or the other for your product.
      </p>
      <ClaimTable
        headers={["Apple category", "Suggested disclosure", "TT source"]}
        rows={[
          [
            "Diagnostics → Crash Data",
            "Yes, if you ship error ingest",
            "Error message/stack via /ingest/error",
          ],
          [
            "Diagnostics → Performance Data",
            "Yes for browser apps with Web Vitals left on; typically No for RN-only",
            "Browser Web Vitals events",
          ],
          [
            "Identifiers → Device ID / User ID",
            "Yes — random anonymous_id (and optional user_id if you set it)",
            "anonymous_id / identify",
          ],
          [
            "Contact Info → Email Address",
            "Only if your app passes email to identify",
            "Optional user_email",
          ],
          [
            "Usage Data → Product Interaction",
            "Yes if you call trackEvent / screen",
            "Custom events and $screen",
          ],
          [
            "Location",
            "Do not declare Precise Location. Locale-derived country is coarse and optional to disclose as non-GPS; many apps omit Location entirely for this SDK alone.",
            "Session country from Intl locale",
          ],
        ]}
      />

      <h2>Google Play Data safety (proposed mapping)</h2>
      <ClaimTable
        headers={["Data type", "Suggested answer", "Notes"]}
        rows={[
          [
            "App info and performance → Crash logs",
            "Collected",
            "Error message and stack",
          ],
          [
            "App info and performance → Diagnostics",
            "Collected when Web Vitals or similar events are enabled",
            "Browser Web Vitals",
          ],
          [
            "Device or other IDs",
            "Collected",
            "anonymous_id; optional user_id",
          ],
          [
            "Personal info → Email",
            "Collected only if you pass it to identify",
            "Optional",
          ],
          [
            "App activity → App interactions",
            "Collected if you send custom events / screens",
            "Optional API use",
          ],
          [
            "Location",
            "Not collected as GPS; locale country is not Play “approximate location” in the usual sense — do not over-claim",
            "Session country heuristic",
          ],
          [
            "Data encrypted in transit",
            "Yes when you use HTTPS ingest (hosted default)",
            "Your deployment must keep TLS",
          ],
          [
            "Users can request deletion",
            "UNVERIFIED on this page — follow your product privacy policy and our hosted terms",
            "Do not invent a deletion SLA here",
          ],
        ]}
      />

      <h2>What we do not claim</h2>
      <ul>
        <li>We do not claim “no PII”, “EU-only processing”, or that scrubbing removes every identifier.</li>
        <li>We do not claim this page replaces a DPA or your store questionnaire legal review.</li>
        <li>
          Cloudflare, email, billing and other processors may still handle traffic for the hosted
          product — see <Link href="/privacy">Privacy</Link>.
        </li>
      </ul>

      <DocsAlsoSee
        links={[
          { href: "/docs/sdk", label: "SDK reference" },
          { href: "/docs/react-native", label: "React Native" },
          { href: "/docs/nextjs", label: "Next.js" },
          { href: "/privacy", label: "Privacy policy" },
        ]}
      />
    </DocsArticle>
  );
}
