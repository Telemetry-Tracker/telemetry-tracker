import type { Metadata } from "next";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "SDK data & privacy labels",
  description: "What our browser and React Native SDKs send, with proposed Apple and Google privacy label mappings.",
  alternates: { canonical: "./" },
};

function DataTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-3 text-left font-medium">{caption}</caption>
        <thead><tr><th scope="col" className="p-2">Data or category</th><th scope="col" className="p-2">When and what to review</th></tr></thead>
        <tbody>{rows.map(([label, detail]) => (
          <tr key={label} className="border-t border-border">
            <th scope="row" className="p-2 align-top font-medium">{label}</th>
            <td className="p-2 align-top">{detail}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function SdkPrivacyPage() {
  return (
    <DocsArticle title="SDK data & privacy labels" lede={<p>We describe what our browser SDKs (@telemetry-tracker/core and @telemetry-tracker/next) and React Native SDK send. Use this inventory to review your app’s disclosures, including the custom data your app supplies.</p>}>
      <h2>What our browser SDK sends</h2>
      <p>After init(), we start a session and install browser error handlers. We send JSON POST requests to your configured ingestUrl at /ingest/session, /ingest/error, /ingest/event and /ingest/batch (events only). Our code sets Content-Type and, when configured, an Authorization Bearer API key. Runtime networking can add headers and cookie behavior depends on the runtime and origin; these are separate from the JSON inventory below. Use HTTPS in production: the SDK accepts a configurable URL and does not enforce HTTPS.</p>
      <DataTable caption="Browser/core payload inventory" rows={[
        ["Shared envelope", "app, platform, environment and release from configuration; generated anonymous_id and sdk_version. Optional fields are omitted when unset."],
        ["Errors", "message, stack when available, context, optional user_id and session_id. Automatic sources are window.onerror and unhandledrejection. Browser error context can include source, filename, lineno and colno; sanitized script errors add sanitized: true and browser_error: sanitized_script_error."],
        ["Sessions", "session_id, app, platform, environment, release, optional user_id and user_email, anonymous_id, sdk_version, country, device_browser, device_os, started_at and ended_at when closed."],
        ["Device hints", "Browser and OS family names parsed from navigator.userAgent, when available. country is a best-effort region from the runtime’s Intl locale, not GPS or IP geolocation; it can be missing or inaccurate. We do not send the raw user agent as a session field."],
        ["Events and screens", "Your trackEvent(name, properties) calls send name, properties, optional user_id and session_id plus the envelope. screen(name) sends a $screen event with a name property; screen navigation requires your app’s calls. Next.js useTrackPage/useTelemetryRouter send the supplied pathname as the screen name; its error boundary adds boundary: TelemetryErrorBoundary to error context."],
        ["Web Vitals", "Enabled by default in a browser; disable with webVitals: false. $web_vital properties include metric (LCP, INP, CLS or TTFB), value, rating, pathname, metric id, navigation_type and connection_type when available. The property is named path and uses location.pathname, without query or hash."],
      ]} />
      <p>Our default capture paths do not record session replay, breadcrumbs, full HTTP request bodies or incoming request headers. They do not read GPS, contacts, photos or clipboard data. Error text, stacks, filenames, paths and any context or properties you supply can still contain personal data or secrets. These statements describe SDK capture, not a guarantee about all data your application sends.</p>

      <h2>Next.js server helper</h2>
      <p>The browser provider uses core. The separate createOnRequestError helper sends message, stack, app, platform, environment, release and sdk_version, with context containing source, runtime, routerKind, routePath, routeType, renderSource, method, path and an optional digest. It strips the query and hash from request.path and does not copy incoming request headers. This path handling does not scrub every string in the report, including message, stack or routePath, and is not a general browser/core query-string policy.</p>

      <h2>React Native data and permissions</h2>
      <p>Our @telemetry-tracker/react-native package is a JavaScript wrapper around core. It starts a session and registers an ErrorUtils handler for unhandled JavaScript errors, adding source: globalHandler and isFatal to context. Its default platform is react-native unless you supply one. It shares the core payload fields above; runtime browser/OS hints may be unavailable, while Intl may still provide a locale-derived country. Web Vitals listeners require browser APIs and do not run in a normal native runtime.</p>
      <p>The package adds no Android or iOS OS permissions and contains no native module, AndroidManifest or Info.plist. It uses the host app’s networking capability. It does not add native crash capture or device model/manufacturer fields. Review permissions from your app and other dependencies separately.</p>

      <h2>Identifiers and storage</h2>
      <p>We generate anonymous_id in UUID form and reuse it from localStorage under tacko_telemetry_anon_id when storage is available. If storage is absent or inaccessible, it remains in memory; normal React Native runtimes use this in-memory behavior, without SDK-provided persistent native storage. The generator prefers Web Crypto and has a fallback for runtimes without it. We generate a session_id for each new session; browser lifecycle handling can start a later session. These identifiers correlate telemetry and should not be treated as proof that data cannot be linked to a person.</p>
      <p>identify(userId, &#123; email &#125;) is optional. We do not discover your account ID or email automatically: user_id and user_email are supplied by your app. Email is sent on the session; user_id also accompanies subsequent events and errors. You can call identify with an ID alone. To clear both values explicitly, use identify(null, &#123; email: null &#125;); clearing only the ID does not clear a previously supplied email.</p>

      <h2>IP addresses and infrastructure</h2>
      <p>Our SDK payloads have no dedicated IP field. The API resolves the connection’s client IP for rate limiting. The Event, ErrorOccurrence and Session database models have no IP column. This does not mean IP addresses cannot appear in free-form data, infrastructure logs or proxy logs: the API also has opt-in IP diagnostic logging. Review your hosting and logging configuration before making storage claims.</p>

      <h2>Scrubbing has limits</h2>
      <aside className="rounded-lg border border-border bg-muted/40 p-4" aria-label="Scrubbing caveats">
        <p>Server ingest scrubbing is best-effort and on by default. It applies pattern and key rules to error message, stack and context, and event properties before storage. Patterns cover common emails, tokens, phone and card formats; extra project deny-keys are additive. Self-host operators can disable it with TELEMETRY_INGEST_PII_SCRUB=false (also 0, off or no).</p>
        <p>Client piiScrub is opt-in and defaults to off. With piiScrub: true or a denyKeys configuration, it scrubs error message, stack and context, and event properties before sending. Its URL rules redact sensitive named parameters such as token or password; it does not strip all query strings. Arbitrary values can remain.</p>
        <p>Neither layer is a complete scrubber. Session identity fields are outside the default rules: user_email is only replaced with [email] when the project explicitly enables scrubSessionUserEmail and server scrubbing is enabled. Client scrubbing does not rewrite user_id or user_email. Avoid putting secrets or unnecessary personal data in telemetry, and inspect representative payloads.</p>
      </aside>
      <p>See our <a href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/PII-SCRUBBING.md">scrubbing reference</a> for settings and limitations.</p>

      <h2>Apple App Privacy: proposed mapping</h2>
      <p>These are review prompts, not completed store answers. Check <a href="https://developer.apple.com/app-store/app-privacy-details/">Apple’s current definitions</a> against your shipped app, all SDKs and how you use the data. Guidance checked 19 October 2026. Browser-only deployments do not themselves require an App Store label.</p>
      <DataTable caption="Proposed Apple categories — confirm for your app" rows={[
        ["Diagnostics → Crash Data / Other Diagnostic Data", "Review JavaScript error reports and runtime/session hints. Our React Native wrapper reports JavaScript errors, not native crash dumps."],
        ["Diagnostics → Performance Data", "Review Web Vitals when running browser capture, including embedded web experiences. Normal native capture does not install browser metrics."],
        ["Identifiers → Device ID / User ID", "Review anonymous_id and session_id against identifier definitions. Optional identify IDs may require User ID. Generated IDs are not advertising IDs; their classification and linkage need app-specific review."],
        ["Contact Info → Email Address", "Include when your app supplies email through identify, or otherwise places email in telemetry. Omitting identify email does not rule out email in free-form text."],
        ["Usage Data → Product Interaction", "Review sessions, custom events and screen names for app usage; custom properties may require additional categories."],
        ["Location → Coarse Location (uncertain)", "country is a locale hint rather than measured physical location. Review its interpretation and use before deciding whether to disclose Coarse Location; default capture does not obtain GPS coordinates."],
      ]} />
      <p>Review App Functionality for debugging and Analytics for usage analysis where applicable. Do not assume “not linked to user” merely because identify is unused: generated IDs and report content can link records. “Not used for tracking” is only a proposed answer if your actual use meets Apple’s definition; this repository cannot establish your app’s downstream uses.</p>

      <h2>Google Play Data safety: proposed mapping</h2>
      <p>Use <a href="https://support.google.com/googleplay/android-developer/answer/10787469?hl=en">Google’s current Data safety guidance</a> and review the full app. Guidance checked 19 October 2026. Our inventory describes transmission off the device; SDK-optional features do not automatically mean collection is optional for the end user.</p>
      <DataTable caption="Proposed Google categories and answers — confirm for your app" rows={[
        ["App info and performance", "Review Crash logs and Diagnostics for JavaScript errors and runtime hints; Other app performance data for browser Web Vitals where used."],
        ["App activity → App interactions", "Review sessions, custom events and screens when used, plus any additional categories represented by custom properties."],
        ["Device or other IDs", "Review generated anonymous_id and session_id. Optional account IDs may also require Personal info → User IDs."],
        ["Personal info → Email address", "Review when your app supplies email, including identify email or free-form content."],
        ["Location → Approximate location (uncertain)", "Review locale-derived country and its use. It is not GPS or a reliable physical location measurement."],
        ["Purpose / collected / shared", "Review Analytics and App functionality as applicable. For hosted TT processing, assess Google’s service-provider sharing exception against your actual agreement and use; self-hosting differs. Do not infer a universal ‘not shared’ answer from SDK code."],
        ["Encrypted in transit", "Use and verify HTTPS for your endpoint and every proxy hop. A configurable ingestUrl does not establish encryption for every deployment."],
        ["Deletion and retention — UNVERIFIED", "This inventory does not verify your deletion request process, retention periods or policy coverage. Confirm product policy and deployment behavior before answering the form."],
      ]} />
      <p>Keep your disclosures aligned with your configuration, payloads and processing practices as they change. Our inventory does not establish a compliance certification or a geographic processing guarantee.</p>
    </DocsArticle>
  );
}
