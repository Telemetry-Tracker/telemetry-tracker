import type { Metadata } from "next";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "React Native",
  description: "Integrate Telemetry Tracker with React Native",
  alternates: { canonical: "./" },
};

export default function DocsReactNativePage() {
  return (
    <DocsArticle
      title="React Native"
      lede={
        <p>
          Use the <code>@telemetry-tracker/react-native</code> package for React Native apps. It
          starts a session on init, registers a global error handler with ErrorUtils, and re-exports{" "}
          <code>trackEvent</code>, <code>trackError</code>, <code>screen</code>, and{" "}
          <code>identify</code>. Sessions and events include anonymous id and SDK version (from
          core).
        </p>
      }
    >
      <h2>Install</h2>
      <CodeBlock
        code={`pnpm add @telemetry-tracker/react-native
# or
npm install @telemetry-tracker/react-native`}
      />

      <h2>Setup</h2>
      <p>
        Call <code>init()</code> once at app startup (e.g. in your root component or entry file),
        on both iOS and Android. The core SDK only installs browser error handlers in a real
        browser, so <code>init()</code> is safe on native and enables <code>screen()</code>,{" "}
        <code>endSession()</code>, and all other APIs—you do not need to guard it for web only.
      </p>
      <p>
        Set <code>platform</code> from <code>Platform.OS</code> so the dashboard can filter by
        device family. Map <code>ios</code>, <code>android</code>, and <code>web</code> (when
        running in a browser). Set <code>release</code> to your app version (e.g. from{" "}
        <code>expo-constants</code> or native build metadata) and <code>environment</code> to
        distinguish production from staging or development builds.
      </p>
      <CodeBlock
        code={`import { Platform } from "react-native";
import Constants from "expo-constants";
import { init } from "@telemetry-tracker/react-native";

init({
  ingestUrl: "https://your-api.example.com",
  app: "my-rn-app",
  apiKey: "tt_live_<publicId>_<secret>",
  platform: Platform.OS === "web" ? "web" : Platform.OS,
  environment: __DEV__ ? "development" : "production",
  release: Constants.expoConfig?.version ?? "1.0.0",
});`}
      />

      <h2>Session tracking</h2>
      <p>
        The package automatically creates a session when you call <code>init()</code> and sends it
        to <code>POST /ingest/session</code>. You can call <code>endSession()</code> when the app
        goes to background if you want to close the session (e.g. in an app state listener).
      </p>

      <h2>Screen tracking</h2>
      <p>
        Call <code>screen(screenName)</code> when the user navigates to a screen (e.g. in your
        navigator’s screen listener or in a useFocusEffect).
      </p>
      <CodeBlock
        code={`import { screen } from "@telemetry-tracker/react-native";

screen("Home");
screen("Profile");`}
      />

      <h2>Events and errors</h2>
      <CodeBlock
        code={`import { trackEvent, trackError, identify } from "@telemetry-tracker/react-native";

trackEvent("button_press", { screen: "Home", id: "submit" });
trackError(new Error("Something broke"), { screen: "Checkout" });
identify(user.id);`}
      />

      <h2>Global error handler</h2>
      <p>
        After <code>init()</code>, the package sets <code>ErrorUtils.setGlobalHandler</code> so
        unhandled JavaScript errors are sent to the ingest API. The previous handler is not
        re-invoked (to avoid duplicate reports).
      </p>

      <DocsAlsoSee
        links={[
          { href: "/error-tracking/react-native", label: "React Native error tracking guide" },
          { href: "/error-tracking/react", label: "React error tracking" },
          { href: "/docs/hosted-cloud", label: "Hosted cloud getting started" },
        ]}
      />
    </DocsArticle>
  );
}
