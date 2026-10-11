# Expo/EAS and Hermes source maps

Telemetry Tracker captures **JavaScript errors only**, not native crashes. This guide covers Expo/EAS and bare React Native Hermes bundles; it does not claim full Expo support. Real EAS builds and device verification are still required for your Expo/RN version.

## SDK and bundle-specific releases

Install `@telemetry-tracker/react-native`. Initialize before app code can throw:

```ts
import { Platform } from "react-native";
import * as Updates from "expo-updates";
import { init, buildBundleRelease } from "@telemetry-tracker/react-native";

// Inject the actual native version/build and an immutable embedded JS build ID.
const nativeVersion = "1.0.0(42)";
const embeddedBundleId = "embedded:android:build-42";
const bundleId = Updates.isEmbeddedLaunch
  ? embeddedBundleId
  : Updates.updateId;
if (!bundleId) throw new Error("Missing JS bundle identity");
const release = buildBundleRelease(nativeVersion, bundleId);
init({
  ingestUrl: "https://api.telemetry-tracker.com",
  apiKey: "tt_live_<publicId>_<secret>",
  app: `my-mobile-${Platform.OS}`,
  platform: Platform.OS,
  release,
});
```

Use a different embedded ID for each distinct embedded bundle (including platform). For bare RN, use an immutable build ID or bundle hash. For OTA, use the **platform update ID**, not the shared update-group ID. Upload with the exact same helper-generated release, including percent encoding. Never reuse a release when JS changes, even if native version/runtimeVersion stays the same. Update upload automation must obtain the assigned update ID from its publication metadata; this guide does not publish updates.

Maps are scoped by project, app and release, **not platform**; separate app labels above prevent Android/iOS collisions. The helper validates nonempty components but cannot prove identity uniqueness. The server refuses multiple matching artifacts; it never falls back to another release or guesses a hashed OTA filename. A wrongly reused release can still select a wrong map, so bundle identity is required operationally.

## Generate the exact shipped maps

### EAS Build / bare release builds

Android's React Native Gradle Hermes pipeline normally composes the Metro packager map with the Hermes bytecode map. Inspect the build logs and retain the final map from the actual release variant, often under `android/app/build/generated/sourcemaps/react/<variant>/index.android.bundle.map`. Paths depend on RN/Expo versions. Do not upload the intermediate `.packager.map` or `.hbc.map` as a final map.

For iOS, configure `SOURCEMAP_FILE` in the Xcode bundle phase/environment **before** `react-native-xcode.sh` runs, for example an absolute writable path to `main.jsbundle.map`. Enable Hermes in the project's supported configuration. Retain the final composed map from that build and confirm it exists; iOS does not always emit a map by default. In EAS, use a config plugin/native build configuration to set this persistently, since prebuild may regenerate native files. Merely setting it in a post-build hook is too late.

### EAS Update

```sh
npx expo export --platform android --source-maps --output-dir dist-android
npx expo export --platform ios --source-maps --output-dir dist-ios
```

Export with the same environment, entry point, dependencies and Hermes configuration as the update. Upload maps from the exact export used for the shipped update, rather than rebuilding later. Inspect the output and build logs for your SDK version: if the exported map already maps bytecode offsets to original sources, do not compose it again. If you have a Metro map plus a separate Hermes map, use the matching RN toolchain to compose them:

```sh
node node_modules/react-native/scripts/compose-source-maps.js \
  index.android.bundle.packager.map index.android.bundle.hbc.map \
  -o index.android.bundle.map
```

The composition order is Metro first, Hermes second. A raw Hermes map alone maps into the generated JS, not your original sources. Newer `x_hermes_function_offsets` metadata is not used by TT; the tested input is a standard composed v3 map and an absolute bytecode-offset stack. Function-relative Hermes stack formats remain unverified.

## Bundle URL and upload

For embedded Android use `index.android.bundle`; for iOS use `main.jsbundle`, after verifying the real release stack. `app:///index.android.bundle`, `assets://index.android.bundle`, file URLs and absolute native paths can match by basename. HTTP-to-HTTP matches retain host/path identity. Multiple artifacts matching a basename are rejected. Releases reaching the 128-artifact metadata limit are conservatively left unsymbolicated, since the capped list cannot prove uniqueness.

For expo-updates, inspect the **actual release stack's sourceURL/path**. If it is a hashed/internal file, upload using that exact path or its unique basename. `index.android.bundle` cannot match an unrelated hash. OTA path conventions are not verified here; do not assume your export filename equals the device filename. If you cannot reliably determine the runtime path, OTA symbolication is not yet configured. Keep only the final matching map for each bundle.

The existing API accepts a JSON object or JSON string in `content`:

```js
// scripts/upload-tt-map.mjs — Node 20+, run in CI, never shipped in the app
import { readFileSync } from "node:fs";
const response = await fetch(`${process.env.TT_API_URL}/api/project/source-maps`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Project-Id": process.env.TT_PROJECT_ID,
    "X-API-Key": process.env.TT_UPLOAD_API_KEY,
  },
  body: JSON.stringify({
    app: process.env.TT_APP,
    release: process.env.TT_RELEASE,
    bundle_url: process.env.TT_BUNDLE_URL,
    content: JSON.parse(readFileSync(process.env.TT_MAP_FILE, "utf8")),
  }),
});
if (!response.ok) throw new Error(`Map upload failed: ${response.status}`);
```

Use a project key with source-map upload enabled, matching any app restriction; keep it in build secrets. Example `package.json` EAS hook (set all `TT_*` values in the build environment, including the final map path):

```json
{
  "scripts": {
    "eas-build-on-success": "node scripts/upload-tt-map.mjs"
  }
}
```

The hook uploads only after the build; it does not generate missing maps. Configure per-platform paths and the same embedded release as the app. For GitHub CI, stage just the final map as `tt-maps/index.android.bundle.map` (or `main.jsbundle.map`) and use the existing action:

```yaml
- uses: Telemetry-Tracker/telemetry-tracker/.github/actions/upload-source-maps@develop
  with:
    api_key: ${{ secrets.TT_UPLOAD_API_KEY }}
    project_id: ${{ vars.TT_PROJECT_ID }}
    app: my-mobile-android
    release: ${{ env.TT_RELEASE }}
    artifact_path: ./tt-maps
    base_url: app://
```

Pin a reviewed commit SHA in production workflows. This yields `app:///index.android.bundle`. For hashed OTA paths, rename the staged final map to the verified runtime basename plus `.map`, or use the API for explicit control. Do not stage intermediate maps: the action recursively uploads all `.map` files.

## Limits and unverified QA

- JS errors only; no native crash capture, native symbol files or debug-ID support.
- Each map is limited to **10 MiB** (10 × 1024 × 1024 bytes of map JSON). Check real composed map sizes before upload; arbitrary map splitting is unsupported.
- Matching uses project/app/release/bundle URL. No automatic EAS metadata discovery or upload integration is included.
- Function labels still use source-map `name` where available; at call sites this can be the callee, not the enclosing function. Original file/line/column is independently tested.
- Fatal reporting waits at most one second for the error request before invoking the previous RN handler; delivery is best effort, not guaranteed before process termination.
- UNVERIFIED: actual Android/iOS release sourceURL strings; expo-updates OTA paths; real composed-map sizes; live upload; dashboard end-to-end symbolication. Verify all on your supported SDK/device versions before relying on this flow.

References: [React Native release debugging](https://reactnative.dev/docs/debugging-release-builds), [Expo update metadata](https://docs.expo.dev/guides/using-sentry/#usage-with-eas-update), [EAS lifecycle hooks](https://docs.expo.dev/build-reference/npm-hooks/), and [source map uploads](source-maps.md).
