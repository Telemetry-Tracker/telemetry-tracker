import Link from "next/link";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { GuideCta } from "@/app/components/marketing/guides/GuideCta";
import { GuideJsonLd } from "@/app/components/marketing/guides/GuideJsonLd";
import { GuideRelatedLinks } from "@/app/components/marketing/guides/GuideRelatedLinks";
import { MarketingGuideLayout } from "@/app/components/marketing/guides/MarketingGuideLayout";
import {
  marketingGuideMetadata,
  webPageJsonLd,
  breadcrumbJsonLd,
} from "@/lib/marketing-guide-metadata";
import { marketingSiteOrigin } from "@/lib/marketing-json-ld";

const PATH = "/error-tracking/react-native/expo-source-maps";
const TITLE = "Expo EAS Update Source Maps: Fix Minified OTA Stack Traces";
const H1 =
  "Expo EAS Update source maps: readable Hermes stack traces for OTA updates";
const DESCRIPTION =
  "Errors from Expo OTA updates point at .expo-internal/<hash> and stay minified. Upload the right Hermes map for every EAS Update. Tested on Android.";
const CODE_1 =
  '// src/telemetry.ts\nimport { Platform } from "react-native";\nimport * as Updates from "expo-updates";\nimport { init, buildBundleRelease } from "@telemetry-tracker/react-native";\n\n// Change this for every native build you ship (store builds embed their own JS bundle).\nconst EMBEDDED_BUNDLE_ID = `embedded:${Platform.OS}:build-42`;\n\nconst bundleId = Updates.isEmbeddedLaunch ? EMBEDDED_BUNDLE_ID : Updates.updateId;\nconst runtime = Updates.runtimeVersion;\n\ninit({\n  ingestUrl: "https://api.telemetry-tracker.com",\n  apiKey: process.env.EXPO_PUBLIC_TT_KEY,\n  app: `my-app-${Platform.OS}`,\n  platform: Platform.OS,\n  // null in dev builds / when expo-updates is disabled: no release, no maps needed\n  release: bundleId && runtime ? buildBundleRelease(runtime, bundleId) : undefined,\n});';
const CODE_2 =
  '{\n  "build": {\n    "production": {\n      "channel": "production",\n      "android": {\n        "buildArtifactPaths": ["android/app/build/generated/sourcemaps/react/release/*.map"]\n      }\n    }\n  }\n}';
const CODE_3 =
  '# EXPO_PUBLIC_* values are inlined when the bundle is built. With --skip-bundler, eas update does NOT rebuild,\n# so the export itself must run with your EAS environment loaded (or with the vars set in CI).\nnpx eas-cli env:exec production "npx expo export --platform android --source-maps --clear --output-dir dist"\nnpx eas-cli update --skip-bundler --input-dir dist --platform android \\\n  --branch production --environment production --message "$(git log -1 --pretty=%s)" \\\n  --json --non-interactive > eas-update.json\nnode scripts/upload-tt-update-maps.mjs dist eas-update.json';
const CODE_4 =
  '// scripts/upload-tt-update-maps.mjs — Node 20+, run in CI right after `eas update`, never shipped in the app.\n// Usage: node scripts/upload-tt-update-maps.mjs <export-dir> <eas-update-json>\nimport { createHash } from "node:crypto";\nimport { readFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { buildBundleRelease } from "@telemetry-tracker/react-native";\n\nconst [distDir = "dist", updatesJson = "eas-update.json"] = process.argv.slice(2);\nconst metadata = JSON.parse(readFileSync(join(distDir, "metadata.json"), "utf8"));\nconst updates = JSON.parse(readFileSync(updatesJson, "utf8")); // output of `eas update --json`\n\nfor (const [platform, files] of Object.entries(metadata.fileMetadata)) {\n  if (platform !== "android" && platform !== "ios") continue; // skip web\n  const update = updates.find((u) => u.platform === platform);\n  if (!update) throw new Error(`No ${platform} update in ${updatesJson}`);\n\n  const bundlePath = join(distDir, files.bundle); // _expo/static/js/<platform>/index-<hash>.hbc\n  // expo-updates saves the downloaded bundle as the manifest\'s launchAsset.key,\n  // which EAS CLI sets to the MD5 of this exact file. That\'s the file name in the stack trace.\n  const deviceFileName = createHash("md5").update(readFileSync(bundlePath)).digest("hex");\n\n  const map = JSON.parse(readFileSync(`${bundlePath}.map`, "utf8")); // already composed for Hermes\n  delete map.sourcesContent; // symbolication only needs mappings/sources/names\n\n  const body = {\n    app: process.env.TT_APP_PREFIX ? `${process.env.TT_APP_PREFIX}-${platform}` : process.env.TT_APP,\n    release: buildBundleRelease(process.env.TT_RELEASE_PREFIX ?? update.runtimeVersion, update.id),\n    bundle_url: deviceFileName,\n    content: map,\n  };\n\n  if (process.env.DRY_RUN) {\n    console.log(platform, { app: body.app, release: body.release, bundle_url: body.bundle_url, mapBytes: JSON.stringify(map).length });\n    continue;\n  }\n\n  const res = await fetch(`${process.env.TT_API_URL ?? "https://api.telemetry-tracker.com"}/api/project/source-maps`, {\n    method: "POST",\n    headers: { "Content-Type": "application/json", "X-API-Key": process.env.TT_UPLOAD_API_KEY },\n    body: JSON.stringify(body),\n  });\n  if (!res.ok) throw new Error(`${platform} map upload failed: ${res.status} ${await res.text()}`);\n  console.log(`${platform}: uploaded map for ${body.release} as ${deviceFileName}`);\n}';
const CODE_5 =
  "md5sum dist/_expo/static/js/android/*.hbc     # Linux\nmd5 -q dist/_expo/static/js/android/*.hbc     # macOS\n# → 0ae689c0639beccfd3b760e124005f1d  (matches .expo-internal/0ae689c0… on the device)";
const CODE_7 =
  "Before:  at applyDiscountB (address at /data/user/0/com.example.app/files/.expo-internal/0ae689c0639beccfd3b760e124005f1d:1:564004)\nAfter:   at applyDiscountB (/src/validation/errorB.ts:4:19)";

export const metadata = marketingGuideMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

export default function ExpoSourceMapsPage() {
  const origin = marketingSiteOrigin();
  return (
    <>
      <GuideJsonLd
        data={[
          webPageJsonLd({
            origin,
            path: PATH,
            name: H1,
            description: DESCRIPTION,
          }),
          breadcrumbJsonLd(origin, [
            {
              name: "React Native error tracking",
              path: "/error-tracking/react-native",
            },
            { name: "Expo source maps", path: PATH },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: H1,
            description: DESCRIPTION,
            url: `${origin}${PATH}`,
            dateModified: "2026-10-19",
            author: { "@type": "Organization", name: "Telemetry Tracker" },
          },
        ]}
      />
      <MarketingGuideLayout
        kicker="Error tracking"
        title={H1}
        updated="2026-10"
        lede={
          <p>
            Errors from users on an EAS Update do not use the store build&apos;s
            map. Three things must line up: release, device file name, and the
            map from the shipped export.
          </p>
        }
      >
        <CodeBlock
          code={CODE_7.split("\n")[0]}
          lang="text"
          caption="Illustrative raw OTA frame (package anonymized)"
        />
        <aside className="rounded-xl border border-border bg-surface/60 p-4">
          TL;DR: Give every JS bundle its own release (runtime version + update
          ID). After <code>eas update</code>, take the <code>.hbc.map</code>{" "}
          from the same export. Upload it under the device file name: the MD5 of
          the exported <code>.hbc</code>. Check one raw frame per platform once.
        </aside>
        <p>
          Tested on: Expo SDK 57, RN 0.86 (0.86.3), expo-updates 57,{" "}
          <code>@telemetry-tracker/react-native</code> 1.3.1, Android (physical
          device), October 2026. We tested one app on one phone against hosted
          TT. iOS: not yet tested.
        </p>
        <p>
          New to the SDK? Start with{" "}
          <Link href="/error-tracking/react-native">
            React Native error tracking
          </Link>
          .
        </p>

        <h2>Why errors from OTA updates stay minified</h2>
        <p>
          Hermes production frames point into bytecode:{" "}
          <code>address at …:1:&lt;offset&gt;</code>. A composed Metro + Hermes
          map turns those offsets back into original files and lines. An OTA
          update is new JavaScript on the same native build, so the store
          build&apos;s map cannot decode it.
        </p>
        <ul>
          <li>
            Wrong release: the app reports its native version while CI uploads
            under a git SHA.{" "}
            <a href="https://github.com/deasystephen/bball-tracker/issues/644">
              This post-mortem
            </a>{" "}
            also found no upload step after updates.
          </li>
          <li>
            Wrong file name: the downloaded bundle runs from{" "}
            <code>.expo-internal</code>, not the export name. See{" "}
            <a href="https://github.com/DataDog/expo-datadog/issues/28">
              Datadog #28
            </a>
            ,{" "}
            <a href="https://github.com/getsentry/sentry-react-native/issues/3967">
              Sentry #3967
            </a>
            , and{" "}
            <a href="https://github.com/rollbar/rollbar-react-native/issues/207">
              Rollbar #207
            </a>
            .
          </li>
          <li>
            No map: <code>eas-build-on-success</code> runs for builds, not
            updates. Each update needs its own upload.
          </li>
        </ul>

        <h2>
          Where the update&apos;s bundle lives on the device (and why the name
          looks random)
        </h2>
        <p>
          On our Android device the bundle ran from{" "}
          <code>
            /data/user/0/&lt;package&gt;/files/.expo-internal/&lt;key&gt;
          </code>
          . The key is the manifest&apos;s <code>launchAsset.key</code>.{" "}
          <a href="https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/project/publish.ts">
            EAS CLI
          </a>{" "}
          sets it to the MD5 of the exact bundle it uploads;{" "}
          <a href="https://github.com/expo/expo/blob/main/packages/expo-updates/android/src/main/java/expo/modules/updates/UpdatesUtils.kt">
            expo-updates on Android
          </a>{" "}
          uses that key for the saved file name.
        </p>
        <CodeBlock
          code={CODE_5}
          lang="bash"
          caption="Compute the Android OTA device file name"
        />
        <p>
          In our test, <code>0ae689c0639beccfd3b760e124005f1d</code> matched the
          exported bundle&apos;s MD5, the manifest key, and the device basename.
          It is different from the hash in <code>index-3ef38676….hbc</code>.
        </p>
        <p>
          Other versions use <code>bundle-&lt;uuid&gt;.js</code> or older
          SHA-256 names (
          <a href="https://github.com/expo/expo/issues/9175">Expo #9175</a>).
          Check one raw frame per platform before trusting this rule.{" "}
          <a href="https://github.com/expo/expo/blob/main/packages/expo-updates/ios/EXUpdates/AppLoader/UpdateAsset.swift">
            iOS saves key + extension
          </a>
          ; we have not checked its device path. Read it from a raw iOS error
          and adjust the upload name if needed.
        </p>
        <p>
          Embedded bundles use <code>index.android.bundle</code> or{" "}
          <code>main.jsbundle</code>. Emergency launches fall back to embedded
          JavaScript, so the embedded map applies.
        </p>

        <h2>Which map to upload</h2>
        <p>
          <code>npx expo export --platform android --source-maps</code> writes{" "}
          <code>_expo/static/js/android/index-&lt;hash&gt;.hbc</code> and{" "}
          <code>.hbc.map</code>. On SDK 57, that map is already Metro + Hermes
          composed. Do not compose it again.
        </p>
        <p>
          Use the exact export that was published. Publish that folder with{" "}
          <code>eas update --skip-bundler --input-dir dist</code>, or keep the
          export left by <code>eas update</code>. Rebuilding later can change
          both MD5 and bytecode offsets.
        </p>
        <p>
          Strip <code>sourcesContent</code> before uploading: our map shrank
          from 3.66 MB to 0.75 MB, about 80%. Symbolication does not need
          embedded source text; source file paths and names remain. EAS Observe
          strips it too.
        </p>

        <h2>Give every JS bundle its own release</h2>
        <p>
          Use runtime version + bundle ID. For OTA, use{" "}
          <code>Updates.updateId</code>, the platform update ID, not the shared
          group ID. The same update can run on every binary with that runtime,
          and CI gets the runtime from <code>eas update --json</code>.
        </p>
        <p>
          For embedded launches, use a unique per-build ID.{" "}
          <code>Updates.isEmbeddedLaunch</code> selects it, including emergency
          fallback launches (<code>Updates.isEmergencyLaunch</code>). Keep the
          embedded map available.
        </p>
        <p>
          Separate app labels per platform: <code>my-app-android</code> and{" "}
          <code>my-app-ios</code>. Maps are scoped by project, app and release,
          not the platform field. Per-update release strings also separate
          updates on TT&apos;s <Link href="/docs/dashboard">Releases page</Link>
          ; we have not verified that view in this device test.
        </p>

        <h2>Set it up with Telemetry Tracker</h2>
        <p>
          TT is our product. This worked example uses one JSON POST per
          platform; no Metro plugin and no Debug IDs. Create a project and keys
          in <Link href="/docs/hosted-cloud">hosted cloud</Link>. See the{" "}
          <Link href="/docs/react-native">SDK reference</Link> and{" "}
          <Link href="/docs/source-maps">upload API and quotas</Link>.
        </p>
        <h3>App</h3>
        <CodeBlock
          code={CODE_1}
          lang="ts"
          caption="src/telemetry.ts — import first in index.ts / App.tsx"
        />
        <p>
          This adapts our verified app: it uses runtime version instead of our
          test&apos;s hard-coded <code>1.0.0(1)</code>. Use the same first
          release component in CI. Change the embedded ID for every native
          build. Exposing <code>EAS_BUILD_ID</code> through app config is
          another approach, but we have not tested it. The public key is an
          ingest key; never ship the upload key in the app.
        </p>
        <h3>Publish an update and upload its maps</h3>
        <p>
          Export under <code>eas env:exec</code> (or set the public variables in
          CI): <code>--skip-bundler</code> does not inline env values later.{" "}
          <code>--clear</code> prevents a local Metro cache from retaining
          transforms without those values. We verified these commands with our
          test app&apos;s preview branch/environment; use your own matching
          environment.
        </p>
        <CodeBlock
          code={CODE_3}
          lang="bash"
          caption="CI — publish the retained export"
        />
        <p>
          Set <code>TT_APP_PREFIX=my-app</code> to match the app, and store{" "}
          <code>TT_UPLOAD_API_KEY</code> in CI secrets: a project key with
          source-map upload enabled. <code>X-Project-Id</code> is optional for
          API-key uploads. Use <code>TT_RELEASE_PREFIX</code> only if the app
          uses that same prefix instead of runtime version.{" "}
          <code>DRY_RUN=1</code> prints the upload identity without sending it.
          For <Link href="/docs/self-hosting">self-hosting</Link>, set{" "}
          <code>TT_API_URL</code>.
        </p>
        <CodeBlock
          code={CODE_4}
          lang="js"
          caption="scripts/upload-tt-update-maps.mjs — Node 20+, CI only"
        />
        <p>
          Any non-2xx upload fails CI on purpose. Do not hide upload failures
          with a successful fallback command. The basename + stripped-map script
          received 2xx from hosted TT for fresh Update C on October 19; its
          final on-device/dashboard symbolication check is still pending.
        </p>
        <h3>Store builds (EAS Build)</h3>
        <CodeBlock
          code={CODE_2}
          lang="json"
          caption="eas.json — retain the composed Android map"
        />
        <p>
          Reuse{" "}
          <a href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/develop/docs/expo-hermes-source-maps.md">
            the advanced guide&apos;s eas-build-on-success uploader
          </a>{" "}
          with <code>TT_BUNDLE_URL=index.android.bundle</code> and{" "}
          <code>TT_MAP_FILE</code> pointing to the composed map under{" "}
          <code>android/app/build/generated/sourcemaps/react/release/</code>.
          Use the same embedded release as the app. Our validated values were{" "}
          <code>
            buildBundleRelease(&quot;1.0.0(1)&quot;, &quot;embedded:android:eas-val-build-1&quot;)
          </code>
          , yielding <code>1.0.0(1)+embedded%3Aandroid%3Aeas-val-build-1</code>.
          We uploaded the retained build artifact from outside EAS; the hook
          itself was not exercised. The advanced guide also covers iOS{" "}
          <code>SOURCEMAP_FILE</code> configuration, unverified by us.
        </p>
        <h3>What you&apos;ll see</h3>
        <figure className="overflow-hidden rounded-xl border border-dashed border-border bg-surface/40">
          <div
            role="img"
            aria-label="Telemetry Tracker error detail showing an EAS Update stack trace symbolicated to errorB.ts line 4"
            className="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            Screenshot placeholder: the error detail Raw/Symbolicated toggle. A
            captured dashboard image will be added after verification.
          </div>
        </figure>
        <CodeBlock
          code={CODE_7}
          lang="text"
          caption="Illustrative raw frame; symbolicated result verified on hosted TT, 2026-10-12"
        />

        <h2>Check it worked (5 minutes, once per platform)</h2>
        <ol>
          <li>
            Publish an update with a deliberate throw behind a debug button.
            Open the app twice: download, then launch the update.
          </li>
          <li>
            Trigger the error. Our device validation used{" "}
            <code>trackError</code> in a catch; global-handler symbolication has
            not been exercised on device.
          </li>
          <li>
            In Raw, compare the frame basename to the exported bundle&apos;s MD5
            and the event&apos;s release to the uploaded release.
          </li>
          <li>
            Switch to Symbolicated and confirm the original file and line.
            Repeat separately for each platform.
          </li>
        </ol>
        <p>
          Configure <Link href="/docs/alerts">alerts</Link> for email or Slack
          delivery when an error opens a new issue. NEW_ERROR_GROUP rules are
          API-only; the dashboard editor authors error-count rules.
        </p>

        <h2>Using EAS Observe, Sentry, PostHog or Datadog instead?</h2>
        <p>
          If you are all-in on EAS, EAS Observe is the simplest option. It
          supports OTA source-map uploads with EAS CLI ≥ 24.9.0. Whichever
          tracker you use, check release identity, device file name, and the map
          from the shipped export.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Tracker</th>
                <th>OTA step</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a href="https://docs.expo.dev/eas/observe/errors/">
                    EAS Observe
                  </a>
                </td>
                <td>
                  <code>eas update --upload-source-maps</code>
                </td>
              </tr>
              <tr>
                <td>
                  <a href="https://docs.sentry.io/platforms/react-native/sourcemaps/uploading/expo/">
                    Sentry
                  </a>
                </td>
                <td>
                  <code>
                    eas update &amp;&amp; npx sentry-expo-upload-sourcemaps dist
                  </code>
                  ; see our{" "}
                  <Link href="/sentry-alternative">Sentry alternative</Link>{" "}
                  overview.
                </td>
              </tr>
              <tr>
                <td>
                  <a href="https://posthog.com/docs/error-tracking/upload-source-maps/react-native">
                    PostHog
                  </a>
                </td>
                <td>
                  <code>posthog-cli hermes upload --directory dist</code>, with
                  its Metro configuration.
                </td>
              </tr>
              <tr>
                <td>
                  <a href="https://docs.datadoghq.com/real_user_monitoring/error_tracking/mobile/expo/">
                    Datadog
                  </a>
                </td>
                <td>
                  <code>datadog-ci react-native upload</code> with the
                  export&apos;s bundle and map.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Troubleshooting</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr>
                <th>Symptom</th>
                <th>Cause</th>
                <th>Fix</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-3 align-top">
                  Frames still point at .expo-internal/&lt;hash&gt;
                </td>
                <td className="px-3 py-3 align-top">
                  Wrong upload name or export.
                </td>
                <td className="px-3 py-3 align-top">
                  Compare the raw basename to MD5 of the published .hbc.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">
                  Symbolicated to the wrong lines
                </td>
                <td className="px-3 py-3 align-top">
                  Reused release or re-exported map.
                </td>
                <td className="px-3 py-3 align-top">
                  Use one release per bundle and the exact published folder.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">
                  Embedded build works, updates do not
                </td>
                <td className="px-3 py-3 align-top">
                  No upload after eas update.
                </td>
                <td className="px-3 py-3 align-top">
                  Upload every update’s map after publication.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">
                  Nothing symbolicates after upload 201
                </td>
                <td className="px-3 py-3 align-top">
                  App label or release differs.
                </td>
                <td className="px-3 py-3 align-top">
                  Match init exactly, including percent encoding; use
                  buildBundleRelease on both sides.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">It worked, then stopped</td>
                <td className="px-3 py-3 align-top">
                  Two matching bundle_url artifacts, or quota reached.
                </td>
                <td className="px-3 py-3 align-top">
                  Keep one matching artifact; re-uploading the same tuple
                  replaces it. Free stores 25 maps across all releases. “Source
                  map storage limit reached” means upgrade or self-host; maps
                  cannot currently be deleted.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">
                  Source map exceeds byte limit / request-size error
                </td>
                <td className="px-3 py-3 align-top">Map exceeds 10 MiB.</td>
                <td className="px-3 py-3 align-top">
                  Strip sourcesContent before upload.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">Upload 401 / 403</td>
                <td className="px-3 py-3 align-top">
                  Wrong key, permission or app restriction.
                </td>
                <td className="px-3 py-3 align-top">
                  Use a project API key with source-map upload enabled for this
                  app.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3 align-top">
                  No errors at all from updated users
                </td>
                <td className="px-3 py-3 align-top">
                  Export missing EXPO_PUBLIC_* env.
                </td>
                <td className="px-3 py-3 align-top">
                  Run export under eas env:exec with --clear, or set public vars
                  in CI. --environment on update cannot fix a prebuilt bundle.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h2>Limits, honestly.</h2>
        <p>
          JavaScript errors only: no native crashes or ANRs. We verified EAS
          Build + EAS Update on Android with one app on one physical phone; iOS
          is untested. The RN SDK captures uncaught JS errors through ErrorUtils
          and errors you explicitly <code>trackError</code>. It does not capture
          unhandled promise rejections: catch async failures at boundaries and
          report them.
        </p>
        <p>
          Each map is limited to 10 MiB. Free stores 25 maps per project across
          all releases; Pro 250; Business 2,500. Maps cannot currently be
          deleted; rotation is tracked in issue #817. A two-platform update
          consumes two artifacts. See <Link href="/pricing">pricing</Link>{" "}
          before planning frequent updates.
        </p>
        <p>
          bsdiff patch updates are untested. There is no automatic EAS
          integration: this is an explicit CI upload step. The EAS build hook,
          iOS device paths, and global-handler symbolication on device remain
          unverified.
        </p>
        <h2>FAQ</h2>
        <h3>
          Do I need to re-upload the store build&apos;s map for every update?
        </h3>
        <p>
          No. Each update gets its own map. Keep the embedded map for users who
          have not updated and for fallback launches.
        </p>
        <h3>Does this work with --platform all?</h3>
        <p>
          The script loops over platforms in metadata.json; each has its own
          update ID and MD5. Use --platform all for both export and update. This
          two-platform path and the iOS device filename are untested by us;
          inspect a raw iOS frame and adjust its upload name before relying on
          it.
        </p>
        <h3>Can I use the update group ID as the release?</h3>
        <p>
          For TT, use the platform update ID with separate app labels. Android
          and iOS bundles differ.
        </p>
        <h3>Do I need Debug IDs?</h3>
        <p>No. TT matches app + release + file name within the project.</p>
        <h3>Does eas update --upload-source-maps help here?</h3>
        <p>
          It uploads to EAS Observe only. TT needs the JSON upload step above.
        </p>
        <GuideCta
          heading="Readable stack traces from every OTA update."
          body="No credit card. Add one upload step after eas update; the Free plan stores 25 source maps per project."
          secondaryHref="/error-tracking/react-native"
          secondaryLabel="React Native setup guide"
        />
        <GuideRelatedLinks
          links={[
            {
              href: "/error-tracking/react-native",
              label: "React Native setup",
              description: "Initialize the SDK and capture JavaScript errors.",
            },
            {
              href: "/docs/react-native",
              label: "React Native SDK reference",
              description: "Options, helpers and global handler behavior.",
            },
            {
              href: "/docs/source-maps",
              label: "Source maps",
              description: "Upload API, matching and storage quotas.",
            },
            {
              href: "/docs/alerts",
              label: "Alerts",
              description: "Get notified when an error opens a new issue.",
            },
          ]}
        />
      </MarketingGuideLayout>
    </>
  );
}
