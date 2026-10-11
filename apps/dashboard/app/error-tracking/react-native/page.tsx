import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  breadcrumbJsonLd,
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
const TITLE = "React Native Error Tracking";
const DESCRIPTION =
  "Install @telemetry-tracker/react-native, call init() at startup, and capture JS errors via ErrorUtils. Free hosted plan, no credit card.";

export function generateMetadata() {
  return marketingGuideMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  });
}

export default function ReactNativeErrorTrackingPage() {
  const origin = marketingSiteOrigin();
  const url = `${origin}${PATH}`;

  return (
    <>
      <GuideJsonLd
        data={[
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
        lede={
          <p>
            <code>@telemetry-tracker/react-native</code> starts a session on init, registers{" "}
            <code>ErrorUtils.setGlobalHandler</code> for unhandled JavaScript errors, and re-exports{" "}
            <code>trackEvent</code>, <code>trackError</code>, <code>screen</code>, and{" "}
            <code>identify</code>. Call <code>init()</code> once at startup on iOS and Android.
          </p>
        }
      >
        <p>
          Core only installs browser error handlers in a real browser, so <code>init()</code> is
          safe on native. This package is not a native iOS/Android crash reporter — it covers
          JavaScript errors in the React Native runtime. There is no dedicated Swift or Kotlin SDK.
        </p>

        <p>
          For Hermes and OTA releases, follow the <a href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/expo-hermes-source-maps.md">Expo/EAS source-map guide</a>.
          Use a unique release for every JS bundle and separate app labels for Android and iOS.
          Native version alone is insufficient for OTA updates. JavaScript errors only; native crashes are not captured.
        </p>

        <h2>What the integration does</h2>
        <ul>
          <li>Creates a session on init (<code>POST /ingest/session</code>).</li>
          <li>
            Sets a global ErrorUtils handler so unhandled JS errors are sent (previous handler is
            invoked after capture; fatal delivery is best effort).
          </li>
          <li>
            <code>screen()</code> for navigator screen names; <code>endSession()</code> if you want
            to close the session on background.
          </li>
        </ul>

        <h2>Install</h2>
        <CodeBlock code={reactNativeInstall} lang="bash" caption="Install" />

        <h2>Minimal setup</h2>
        <p>
          Call init in the root component or entry file. Set <code>platform</code> from{" "}
          <code>Platform.OS</code> so the dashboard can filter by device family. The{" "}
          <code>release</code> must identify the exact JS bundle for source maps; follow the guide
          above for OTA update and embedded-build identities.
        </p>
        <CodeBlock code={reactNativeSetup} lang="typescript" caption="init" />

        <h2>Screens and a test error</h2>
        <CodeBlock code={reactNativeScreen} lang="typescript" caption="screen()" />
        <CodeBlock code={reactNativeTestError} lang="typescript" caption="Test error" />
        <p>
          Call <code>screen(name)</code> from a navigator listener or <code>useFocusEffect</code>.
          Then trigger <code>trackError</code> once and open Issues.
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

        <GuideCta />
        <GuideRelatedLinks
          links={[
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
