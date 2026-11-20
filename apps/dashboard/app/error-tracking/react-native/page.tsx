import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  howToJsonLd,
  marketingGuideMetadata,
  webPageJsonLd,
} from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";
import {
  reactNativeInstall,
  reactNativeScreen,
  reactNativeSetup,
  reactNativeTestError,
} from "@/lib/sdk-setup-snippets";

const PATH = "/error-tracking/react-native";
const TITLE = "React Native Error Tracking: What Is Caught, Boundaries, Hermes";
const DESCRIPTION =
  "React Native error tracking with a pure-JS SDK: what init() reports on its own, how to add error boundaries and async errors, and readable Hermes stacks.";

const RN_BOUNDARY_SNIPPET = `// AppErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { trackError } from "@telemetry-tracker/react-native";

type Props = { children: ReactNode };

export class AppErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackError(error, {
      source: "react-native.ErrorBoundary",
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text>Something went wrong.</Text>
        <Pressable onPress={() => this.setState({ hasError: false })}>
          <Text>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

// App.tsx: wrap the whole tree once, and add more boundaries around risky screens.
// <AppErrorBoundary><RootNavigator /></AppErrorBoundary>`;

const RN_ASYNC_SNIPPET = `import { trackError } from "@telemetry-tracker/react-native";

async function loadProfile(userId: string) {
  try {
    const res = await fetch(\`https://api.example.com/users/\${userId}\`);
    if (!res.ok) throw new Error(\`Profile request failed: \${res.status}\`);
    return await res.json();
  } catch (error) {
    // An async function that rejects with no catch is NOT reported by SDK 1.3.x.
    trackError(error, { source: "loadProfile" });
    throw error; // keep your own error handling (toast, retry, fallback)
  }
}`;

const FAQ = [
  {
    question: "Does the React Native SDK report unhandled promise rejections?",
    answer:
      "Not in @telemetry-tracker/react-native 1.3.x. A rejected promise that nobody catches (for example an async function called without await or catch) is not sent. Catch it and call trackError in the catch block. Automatic rejection tracking is planned but not shipped yet.",
  },
  {
    question: "Does it capture native iOS and Android crashes?",
    answer:
      "No. The package is JavaScript only: it reports errors thrown in the React Native JavaScript runtime. Crashes in Java, Kotlin, Objective-C or Swift code, out-of-memory kills and ANRs are not captured, and there is no Swift or Kotlin SDK.",
  },
  {
    question: "Do I need an error boundary if the SDK installs a global handler?",
    answer:
      "Yes. An error boundary catches render errors and shows a fallback, so React treats them as handled and they never reach the ErrorUtils global handler. Report them with trackError in componentDidCatch. A root boundary also covers render errors with no other boundary, a case we have not yet verified on a release build.",
  },
  {
    question: "Will an error be reported twice if I call trackError and the global handler also sees it?",
    answer:
      "No. The SDK remembers each Error object it has sent and ignores a second report of the same object, so a manual trackError followed by the global handler for the same error creates one issue.",
  },
  {
    question: "Why do my React Native stack traces point at index.android.bundle or a hash?",
    answer:
      "Release builds run Hermes bytecode, so frames show bundle offsets instead of your files. Upload the Hermes source map for every store build and every OTA update under the same app and release you pass to init(). The Expo EAS Update guide shows which map to take and how to name it.",
  },
  {
    question: "Does it need a native module, config plugin or prebuild?",
    answer:
      "No. @telemetry-tracker/react-native is plain JavaScript on top of @telemetry-tracker/core, uses fetch and React Native's ErrorUtils, and ships no native code or Expo config plugin, so there is nothing to link and no extra prebuild step.",
  },
] as const;

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    omitBrandSuffix: true,
  });
}

export default function ReactNativeErrorTrackingPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
          faqPageJsonLd(FAQ),
          webPageJsonLd({ origin, path: PATH, name: TITLE, description: DESCRIPTION }),
          breadcrumbJsonLd(origin, [
            { name: "Home", path: "" },
            { name: "React Native error tracking", path: PATH },
          ]),
          howToJsonLd({
            name: "Set up React Native error tracking with Telemetry Tracker",
            description: DESCRIPTION,
            url,
            steps: [
              {
                name: "Create a free account",
                text: "Register, create a project, and copy a tt_live API key. No credit card is required.",
              },
              {
                name: "Install the React Native SDK",
                text: "Add @telemetry-tracker/react-native to the app.",
              },
              {
                name: "Call init at startup",
                text: "Pass ingest URL, app name, API key, and Platform.OS. Safe on iOS, Android, and web.",
              },
              {
                name: "Add a root error boundary",
                text: "Wrap the app in an error boundary that calls trackError in componentDidCatch, because boundary-caught render errors do not reach the global handler.",
              },
              {
                name: "Send a test error",
                text: "Call trackError, then open Issues in the dashboard.",
              },
            ],
          }),
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title="React Native error tracking"
        updated="2026-11"
        lede={
          <p>
            <code>@telemetry-tracker/react-native</code> starts a session on init, registers{" "}
            <code>ErrorUtils.setGlobalHandler</code> for uncaught JavaScript errors, and re-exports{" "}
            <code>trackEvent</code>, <code>trackError</code>, <code>screen</code>, and{" "}
            <code>identify</code>. Call <code>init()</code> once at startup on iOS and Android, then
            add the two things the global handler cannot see: error boundaries and caught async
            errors.
          </p>
        }
      >
        <p>
          Core only installs browser error handlers in a real browser, so <code>init()</code> is
          safe on native. This package is not a native iOS/Android crash reporter — it covers
          JavaScript errors in the React Native runtime. There is no dedicated Swift or Kotlin SDK.
        </p>

        <p>
          For Hermes and OTA releases, follow the <a href="/error-tracking/react-native/expo-source-maps">Expo/EAS source-map guide</a>.
          Use a unique release for every JS bundle and separate app labels for Android and iOS.
          Native version alone is insufficient for OTA updates. JavaScript errors only; native crashes are not captured.
        </p>

        <h2>What the integration does</h2>
        <ul>
          <li>Creates a session on init (<code>POST /ingest/session</code>).</li>
          <li>
            Sets a global ErrorUtils handler once and keeps the previous one. Non-fatal errors are
            sent and then passed to the previous handler. For a fatal error the SDK waits for the
            send to finish, at most one second, and then calls the previous handler, so React
            Native&rsquo;s own crash behavior is unchanged. Fatal delivery is best effort.
          </li>
          <li>
            <code>screen()</code> for navigator screen names; <code>endSession()</code> if you want
            to close the session on background.
          </li>
          <li>
            Plain JavaScript: no native module and no Expo config plugin, so there is nothing to
            link and no extra prebuild step.
          </li>
        </ul>

        <h2>Install</h2>
        <CodeBlock code={reactNativeInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>
          Call init in the root component or entry file. Set <code>platform</code> from{" "}
          <code>Platform.OS</code> so the dashboard can filter by device family. The{" "}
          <code>release</code> must identify the exact JS bundle for source maps. The app version
          in the snippet only works if every store build gets its own version and you ship no OTA
          updates; otherwise follow the guide above for update and embedded-build identities.
        </p>
        <CodeBlock code={reactNativeSetup} lang="typescript" caption="init" />

        <h2>Screens and a test error</h2>
        <CodeBlock code={reactNativeScreen} lang="typescript" caption="screen()" />
        <CodeBlock code={reactNativeTestError} lang="typescript" caption="Test error" />
        <p>
          Call <code>screen(name)</code> from a navigator listener or <code>useFocusEffect</code>.
          Then trigger <code>trackError</code> once and open Issues.
        </p>

        <h2 id="what-is-captured">Which React Native errors are reported</h2>
        <p>
          A React Native app fails in several places, and they do not all reach the same handler.
          This is what SDK 1.3.x reports on its own and what you add yourself:
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface/70 text-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Error</th>
                <th className="px-4 py-3 font-medium">How it is reported</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">
                  Uncaught throw outside rendering (press handler, timer, other app code)
                </td>
                <td className="px-4 py-3 align-top">
                  Automatic through the <code>ErrorUtils</code> global handler, fatal or not
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Render error caught by an error boundary</td>
                <td className="px-4 py-3 align-top">
                  Not automatic. Call{" "}
                  <a href="#error-boundaries" className="text-brand hover:underline">
                    <code>trackError</code> in <code>componentDidCatch</code>
                  </a>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Render error with no error boundary at all</td>
                <td className="px-4 py-3 align-top">
                  Not yet verified on a release build. Add a root boundary so it is reported either
                  way
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">
                  Rejected promise nobody handles (async function without catch)
                </td>
                <td className="px-4 py-3 align-top">
                  Not reported in 1.3.x.{" "}
                  <a href="#async-errors" className="text-brand hover:underline">
                    Catch it and call <code>trackError</code>
                  </a>
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">Error you catch yourself (try/catch, failed fetch)</td>
                <td className="px-4 py-3 align-top">
                  Call <code>trackError(error, context)</code> in the catch block
                </td>
              </tr>
              <tr className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top">
                  Native crash (Java/Kotlin, Objective-C/Swift), out-of-memory kill, ANR
                </td>
                <td className="px-4 py-3 align-top">Not captured: this is a JavaScript SDK</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 id="error-boundaries">Report errors caught by error boundaries</h2>
        <p>
          An error boundary shows a fallback instead of a blank or crashed screen. React then treats
          the error as handled, so it is not passed to the <code>ErrorUtils</code> global handler
          and the SDK never sees it. Report it from the boundary&rsquo;s{" "}
          <code>componentDidCatch</code>. Wrap the whole app once, then add boundaries around
          screens that should fail on their own.
        </p>
        <CodeBlock code={RN_BOUNDARY_SNIPPET} lang="tsx" caption="Error boundary with trackError" />
        <ul>
          <li>
            Using the <code>react-error-boundary</code> package? Call <code>trackError</code> in its{" "}
            <code>onError</code> prop instead of writing a class.
          </li>
          <li>
            <strong>Component stack:</strong> there is no dedicated field yet, so it is sent as
            error context and shown with the other context on the issue. Context strings are
            truncated at 16 KB at ingest.
          </li>
          <li>
            <strong>No duplicates:</strong> the SDK ignores a second report of the same{" "}
            <code>Error</code> object, so reporting from a boundary and from the global handler does
            not create two issues.
          </li>
        </ul>

        <h2 id="async-errors">Report errors from async code</h2>
        <p>
          Error boundaries do not catch errors in event handlers, timers or promises. A synchronous
          throw in a press handler still reaches the global handler, but a rejected promise that
          nobody handles does not: SDK 1.3.x has no promise rejection tracking. Catch errors where
          you call the API and report them:
        </p>
        <CodeBlock code={RN_ASYNC_SNIPPET} lang="typescript" caption="Report a caught async error" />
        <p>
          Add context you will need when triaging, such as the screen or the request, and call{" "}
          <code>identify(userId)</code> after login so later errors carry the user ID. Hosted ingest
          applies best-effort PII scrubbing by default; <code>piiScrub: true</code> in{" "}
          <code>init()</code> also redacts common secrets on the device before sending (opt-in; see{" "}
          <Link href="/docs/sdk-privacy" className="text-brand hover:underline">
            SDK privacy
          </Link>
          ).
        </p>

        <h2 id="delivery">Crashes, offline devices and delivery</h2>
        <ul>
          <li>
            Errors are sent right away, one request each. Events and screens are batched (every 5
            seconds or 10 items by default).
          </li>
          <li>
            There is no offline queue: if the device has no connection when an error happens, that
            report is not retried later. The SDK logs the failed send with{" "}
            <code>console.warn</code> and never throws into your app.
          </li>
          <li>
            On a fatal error the app is about to close, so the SDK gives the send up to one second
            before handing over to React Native&rsquo;s default handler. A slow network can still
            lose that report.
          </li>
        </ul>

        <h2 id="source-maps">Readable stack traces with Hermes source maps</h2>
        <p>
          Release builds run Hermes bytecode, so raw frames point at the bundle instead of your
          files. Upload the source map of each store build and of each OTA update, under the same{" "}
          <code>app</code> and <code>release</code> you pass to <code>init()</code>. The{" "}
          <Link
            href="/error-tracking/react-native/expo-source-maps"
            className="text-brand hover:underline"
          >
            Expo EAS Update source-map guide
          </Link>{" "}
          covers which map to take, the device file name and a release per JS bundle. Upload API
          and quotas are in{" "}
          <Link href="/docs/source-maps" className="text-brand hover:underline">
            source maps
          </Link>
          ; the Free plan keeps up to 25 source map artifacts per project.
        </p>

        <h2>What you will see</h2>
        <p>
          Issues lists grouped JS exceptions with the context you attached. Sessions appear under
          Sessions (start/end, not session replay). Filter by <code>app</code>, platform, and
          release when those fields are set at init.
        </p>
        <p>
          Free hosted plan: €0, no credit card, 250K ingest units per month, 14-day retention.{" "}
          <Link href="/pricing" className="text-brand hover:underline">
            Pricing
          </Link>
          .
        </p>

        <h2>What it does not do</h2>
        <ul>
          <li>No native crash reporting, no session replay and no distributed tracing.</li>
          <li>No automatic promise rejection or error boundary reporting yet (see above).</li>
          <li>
            Not compatible with the Sentry SDK: you replace <code>@sentry/react-native</code> with
            this package rather than changing a DSN. See{" "}
            <Link href="/docs/migrate-from-sentry" className="text-brand hover:underline">
              Migrate from Sentry
            </Link>
            .
          </li>
        </ul>

        <h2>FAQ</h2>
        {FAQ.map((item) => (
          <div key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </div>
        ))}

        <h2>Full documentation</h2>
        <p>
          <Link href="/docs/react-native" className="text-brand hover:underline">
            React Native SDK docs
          </Link>
          . Account and API keys:{" "}
          <Link href="/docs/hosted-cloud" className="text-brand hover:underline">
            Hosted cloud
          </Link>
          .
        </p>

        <h2>Browser Web Vitals</h2>
        <p>
          LCP, INP, CLS and TTFB are browser measurements and are not collected from native
          React Native apps. If your project also has a web frontend, the browser SDK collects them by default
          in the same dashboard. See the{" "}
          <Link href="/docs/sdk#sdk-web-vitals-heading" className="text-brand hover:underline">
            Web Vitals configuration
          </Link>
          .
        </p>

        <GuideCta />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/react-native/expo-source-maps",
              label: "Expo EAS Update source maps",
              description: "Readable Hermes stack traces for OTA updates.",
            },
            {
              href: "/error-tracking/react",
              label: "React error tracking",
              description: "Same core APIs in the browser.",
            },
            {
              href: "/docs/react-native",
              label: "React Native docs",
              description: "Sessions, screens, and ErrorUtils notes.",
            },
            {
              href: "/docs/sdk",
              label: "SDK reference",
              description: "init options shared with core.",
            },
            {
              href: "/sentry-alternative",
              label: "Sentry alternative",
              description: "When a smaller open-source tool is enough.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
