import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import { breadcrumbJsonLd, faqPageJsonLd, howToJsonLd, marketingGuideMetadata } from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";
import { EXPO_ROUTER_BOUNDARY_DRAFT } from "@/lib/draft-guides";

const PATH = EXPO_ROUTER_BOUNDARY_DRAFT.path;
const TITLE = "Expo Router ErrorBoundary: Report Caught Errors (with Code)";
const H1 = "Expo Router ErrorBoundary: report the errors it catches";
const DESCRIPTION = "Errors caught by an Expo Router ErrorBoundary bypass your global error handler. Report them with route context, keep retry, and avoid duplicate reports.";
export function generateMetadata() {
  return {
  ...marketingGuideMetadata({ title: TITLE, description: DESCRIPTION, path: PATH }),
  robots: EXPO_ROUTER_BOUNDARY_DRAFT.robots,
  };
}
const CODE = [
  "import { useEffect } from \"react\";\nimport { Pressable, Text, View } from \"react-native\";\nimport { useSegments, type ErrorBoundaryProps } from \"expo-router\";\nimport { trackError } from \"@telemetry-tracker/react-native\";\n\n// Expo Router renders this when a route throws during render.\n// It doesn't report anything by itself, so we do it here.\nexport function createReportingErrorBoundary(boundary: string) {\n  return function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {\n    // Route pattern, e.g. \"/(tabs)/orders/[id]\": no IDs or user data.\n    const route = \"/\" + useSegments().join(\"/\");\n\n    useEffect(() => {\n      // In an effect, not in render. The SDK dedupes the same Error object,\n      // so StrictMode, re-renders and remounts still send one report.\n      trackError(error, { handled_by: \"expo-router-error-boundary\", boundary, route });\n    }, [error, route]);\n\n    // No theme/i18n/safe-area hooks: this may render above those providers.\n    return (\n      <View style={{ flex: 1, alignItems: \"center\", justifyContent: \"center\", padding: 24 }}>\n        <Text style={{ fontSize: 18, marginBottom: 12 }}>Something went wrong.</Text>\n        <Pressable onPress={retry} accessibilityRole=\"button\">\n          <Text style={{ fontSize: 16, color: \"#2563eb\" }}>Try again</Text>\n        </Pressable>\n      </View>\n    );\n  };\n}\n",
  "import { Stack } from \"expo-router\";\nimport { createReportingErrorBoundary } from \"@/components/ReportingErrorBoundary\";\nimport \"@/lib/telemetry\"; // init() once, before anything renders\n\nexport const ErrorBoundary = createReportingErrorBoundary(\"root\");\n\nexport default function RootLayout() {\n  return <Stack />;\n}\n",
  "// app/(tabs)/_layout.tsx\nimport { Tabs } from \"expo-router\";\nimport { createReportingErrorBoundary } from \"@/components/ReportingErrorBoundary\";\n\nconst TabsScreenBoundary = createReportingErrorBoundary(\"tabs-screen\");\n\n// Option A: applies to all screens of this layout (and nested layouts inherit it)\nexport const unstable_settings = { screenErrorBoundary: TabsScreenBoundary };\n\nexport default function TabsLayout() {\n  return <Tabs />;\n  // Option B (same effect): <Tabs unstable_screenErrorBoundary={TabsScreenBoundary} />\n}\n",
  "import { createReportingErrorBoundary } from \"@/components/ReportingErrorBoundary\";\n\nexport const ErrorBoundary = createReportingErrorBoundary(\"checkout\");\n",
  "import { trackError } from \"@telemetry-tracker/react-native\";\n\n// Event handlers and async code: not caught by any ErrorBoundary.\nasync function onPay() {\n  try {\n    await submitPayment();\n  } catch (e) {\n    trackError(e, { action: \"pay\" }); // TT RN 1.3.2 doesn't capture unhandled promise rejections\n    showToast(\"Payment failed, please try again\");\n  }\n}\n// Uncaught synchronous errors outside render (e.g. in setTimeout) go to the global handler\n// that init() installs, so you don't need to do anything for those.\n",
  "// app/debug/crash.tsx \u2014 preview builds only; keep the flag off in production.\nimport { Redirect } from \"expo-router\";\n\nexport default function Crash() {\n  if (process.env.EXPO_PUBLIC_SHOW_DEBUG !== \"1\") return <Redirect href=\"/\" />;\n  throw new Error(\"Boundary test: render error\");\n}\n"
];
const FAQ = [
  {
    "question": "Does Expo Router report errors caught by ErrorBoundary?",
    "answer": "No. The route boundary renders your fallback with error and retry; report the caught error explicitly."
  },
  {
    "question": "Why is my ErrorUtils global handler not called?",
    "answer": "Caught render errors follow React Native\u2019s ExceptionsManager path rather than ErrorUtils. Real Android release-build behavior still awaits verification."
  },
  {
    "question": "Will the error be reported twice?",
    "answer": "Telemetry Tracker dedupes the same Error object, including effect reruns and remounts. A new Error object is a separate report; this is not message-based deduplication."
  },
  {
    "question": "Does ErrorBoundary catch errors in onPress or async code?",
    "answer": "No. Catch event-handler and async failures where they occur and call trackError. The React Native SDK 1.3.2 does not automatically capture unhandled promise rejections."
  },
  {
    "question": "Can I add this via EAS Update?",
    "answer": "Telemetry Tracker\u2019s SDK is pure JavaScript. You can add it and the boundary via EAS Update if your app already has a dev client/build with the same runtime version."
  },
  {
    "question": "What is screenErrorBoundary?",
    "answer": "It is an unstable expo-router 57+ layout option for a shared screen fallback. A screen export takes precedence over the navigator prop, which takes precedence over unstable_settings; nested layouts inherit it and null opts out."
  }
];

export default function ExpoRouterErrorBoundaryPage() {
  const origin = marketingSiteOrigin();
  return <>
    <GuideJsonLd data={[
      howToJsonLd({ name: H1, description: DESCRIPTION, url: `${origin}${PATH}`, steps: [
        { name: "Initialize the SDK", text: "Initialize once before rendering the app." },
        { name: "Report in the fallback effect", text: "Use a shared provider-free reporting boundary with route-pattern context and retry." },
        { name: "Attach boundaries", text: "Export a root boundary and optionally configure navigator and screen fallbacks." },
        { name: "Verify on Android", text: "Before publishing this draft, verify reports and retry in a real Android release build." },
      ] }),
      breadcrumbJsonLd(origin, [{ name: "Home", path: "" }, { name: "React Native error tracking", path: "/error-tracking/react-native" }, { name: "Expo Router ErrorBoundary", path: PATH }]),
      faqPageJsonLd(FAQ),
    ]} />
    <MarketingGuideLayout kicker="Error tracking · unpublished draft" title={H1} updated="2026-11" lede={<p>You added an ErrorBoundary export and replaced a broken screen with a friendly “Try again”. But caught render errors are not passed to the global handler your tracker listens on. We’ll add explicit reporting in one shared component.</p>}>
      <aside className="rounded-xl border border-border p-4">Unpublished draft: publishing waits for Sanja’s Android device verification and her approval. The examples below have not been verified in a real Expo release build on a phone.</aside>
      <p>New to the platform? Start with <Link href="/error-tracking/react-native">React Native error tracking</Link>.</p>
      <h2>Why caught errors never reach your tracker</h2>
      <p>Expo Router’s Try boundary uses getDerivedStateFromError to render your fallback with error and retry. It does not report the error. In the source versions reviewed for this guide (expo-router 58.0.29 and React Native 0.88.1), caught render errors follow onCaughtError to ExceptionsManager (console/native logging), bypassing ErrorUtils.setGlobalHandler. JS-only trackers such as ours need an explicit capture call here.</p>
      <CodeBlock lang="text" code={`Render throws → Expo Router Try → your ErrorBoundary fallback
React Native onCaughtError → ExceptionsManager → console/native logging
Caught-error path ≠ ErrorUtils.setGlobalHandler`} />
      <p>See <a href="https://docs.expo.dev/router/error-handling/">Expo’s error-handling documentation</a> and <a href="https://github.com/getsentry/sentry-react-native/issues/6160">Sentry’s original reporting issue</a>. Uncaught render errors without any boundary remain unresolved: we do not claim whether the global handler receives them until the Android check below is complete.</p>
      <h2>One reporting boundary component</h2>
      <p>We use trackError from our Telemetry Tracker SDK; with another tracker, swap that one capture call. Install it, then initialize once before the app renders, following <Link href="/docs/react-native">the SDK reference</Link>.</p>
      <CodeBlock lang="bash" code="npx expo install @telemetry-tracker/react-native" />
      <CodeBlock lang="tsx" caption="lib/telemetry.ts — use your ingest URL and project key" code={`import { Platform } from "react-native";
import Constants from "expo-constants";
import { init } from "@telemetry-tracker/react-native";

init({
  ingestUrl: "https://your-api.example.com",
  app: "my-rn-app",
  apiKey: "tt_live_<publicId>_<secret>",
  platform: Platform.OS === "web" ? "web" : Platform.OS,
  environment: __DEV__ ? "development" : "production",
  release: Constants.expoConfig?.version ?? "1.0.0",
});`} />
      <CodeBlock lang="tsx" caption="components/ReportingErrorBoundary.tsx" code={CODE[0]} />
      <p>Report in an effect, never in the render body. The SDK dedupes by Error object; it does not combine distinct errors with the same message. useSegments gives a route pattern such as /(tabs)/orders/[id], without the actual order ID. Avoid usePathname and user data in context; review <Link href="/docs/sdk-privacy">PII scrubbing</Link>. The fallback uses no theme, i18n or safe-area hooks because it may render above those providers.</p>
      <p>TODO before publishing: verify useSegments inside the root fallback on Sanja’s Android phone. If it fails there, remove route collection from the root fallback and keep boundary context. Do not substitute a pathname containing real IDs.</p>
      <h2>Use it at every level</h2>
      <h3>Root layout</h3>
      <CodeBlock lang="tsx" caption="app/_layout.tsx" code={CODE[1]} />
      <h3>Every screen in a navigator</h3>
      <p>expo-router 57+ supports unstable_settings.screenErrorBoundary and the navigator prop unstable_screenErrorBoundary. These unstable APIs may change; re-check the Expo docs before publishing.</p>
      <CodeBlock lang="tsx" caption="app/(tabs)/_layout.tsx" code={CODE[2]} />
      <p>Precedence: screen ErrorBoundary export, then navigator prop, then unstable_settings. Nested layouts inherit the setting; set it to null to opt out.</p>
      <h3>A screen with its own fallback</h3>
      <CodeBlock lang="tsx" caption="app/(tabs)/checkout.tsx — add alongside your screen component" code={CODE[3]} />
      <h2>What a boundary does not catch</h2>
      <p>Error boundaries do not catch event handlers, timers, async work or promise rejections. Uncaught synchronous errors outside render use the global handler installed by init; the timer path still needs device verification here. React Native SDK 1.3.2 does not automatically capture unhandled promise rejections, native crashes or componentStack. Catch async work explicitly.</p>
      <CodeBlock lang="tsx" caption="Payment handler — submitPayment and showToast are app functions" code={CODE[4]} />
      <h2>Readable stack traces</h2>
      <p>Give each JavaScript bundle a release using buildBundleRelease(nativeVersion, bundleId), and upload its matching Hermes source map. Follow the <Link href="/error-tracking/react-native/expo-source-maps">EAS Build and Update source-map guide</Link> and <Link href="/docs/releases">release naming reference</Link>.</p>
      <h2>Test it in a release build</h2>
      <p>Development LogBox/redbox behavior differs. Use a preview release build or an EAS Update to a preview channel, never a production test. Enable this screen only for the preview check; keep EXPO_PUBLIC_SHOW_DEBUG off in production.</p>
      <CodeBlock lang="tsx" caption="Preview-only throwing screen" code={CODE[5]} />
      <ol>
        <li>TODO — Sanja: confirm the fallback appears on a physical Android phone and one issue arrives with handled_by, boundary, route and release.</li>
        <li>Turn the preview flag off in the next preview bundle and confirm normal rendering; also test retry with a recoverable render failure. A deterministic throw will throw again on retry.</li>
        <li>Repeat with no ErrorBoundary exports or inherited screen boundaries. Record whether the tracker receives the error and whether the app closes. Update this guide and report any product gap before approval.</li>
        <li>Optionally verify an uncaught synchronous timer error and an unhandled rejection separately.</li>
      </ol>
      <figure className="rounded-xl border border-dashed border-border p-6"><figcaption>TODO: real dashboard screenshot after Android verification, showing handled_by, boundary, route and release. No device result is claimed yet.</figcaption></figure>
      <p>Once verified, configure <Link href="/docs/alerts">error-count alerts</Link> for notifications.</p>
      <h2>Using another tracker?</h2>
      <p>Telemetry Tracker is our product. Sentry provides wrapExpoRouterErrorBoundary (8.16.0) and opt-in autoWrapExpoRouterErrorBoundary (8.17.2+); check <a href="https://docs.sentry.io/platforms/react-native/guides/expo/tracing/instrumentation/expo-router/">its current instrumentation docs</a> before publishing. <a href="https://docs.expo.dev/eas/observe/errors/">EAS Observe</a> has ObserveErrorBoundary. Use the wrapper appropriate to your tracker or substitute its capture call in this pattern. See our <Link href="/sentry-alternative">Sentry alternative overview</Link>. For web React, use the <Link href="/error-tracking/react">React guide</Link>.</p>
      <h2>FAQ</h2>
      {FAQ.map(({ question, answer }) => <section key={question}><h3>{question}</h3><p>{answer}</p></section>)}
      <h2>Add explicit boundary reporting</h2>
      <p>Create a Telemetry Tracker project, add the SDK and one shared boundary, then verify a preview error with its route context. See <Link href="/pricing">pricing</Link>, <Link href="/docs/hosted-cloud">hosted cloud setup</Link> and the <Link href="/docs/react-native">React Native SDK reference</Link>.</p>
    </MarketingGuideLayout>
  </>;
}
