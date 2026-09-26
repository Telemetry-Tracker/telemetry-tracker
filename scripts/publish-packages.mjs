#!/usr/bin/env node
/**
 * Publish SDK packages to npm in order: telemetry-core first, then packages that depend on it.
 *
 * Releases must run from a **clean, tagged origin/main** checkout. The script stamps `gitHead`
 * on each published package.json so the tarball traces to the exact commit. Package
 * `prepublishOnly` blocks direct folder publishes unless this script sets
 * TELEMETRY_SDK_RELEASE_PUBLISH=1.
 *
 * Tag each package version on the release commit, e.g.:
 *   sdk-core-v1.5.0  sdk-node-v1.4.0  sdk-vite-plugin-v1.1.0
 * (or `@telemetry-tracker/core@1.5.0`, …), push tags, then:
 *   pnpm publish:packages -- --only=core,node,vite-plugin --otp=123456
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import {
  SDK_RELEASE_PUBLISH_ENV,
  assertAllowDirtyPolicy,
  assertCleanWorkingTree,
  assertHeadIsTagged,
  assertHeadMatchesOriginMain,
  assertNoWorkspaceProtocolDeps,
  assertPackageReleaseTag,
  assertTagsPushedToOrigin,
  loadOriginTagMap,
  stampGitHead,
} from "./lib/publish-guards.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const packagesDir = join(root, "packages");

const coreName = "telemetry-core";
const coreDep = "@telemetry-tracker/core";
const allDependents = [
  "telemetry-next",
  "telemetry-node",
  "telemetry-react-native",
  "telemetry-vite-plugin",
];

const folderByAlias = {
  core: "telemetry-core",
  node: "telemetry-node",
  next: "telemetry-next",
  "react-native": "telemetry-react-native",
  "vite-plugin": "telemetry-vite-plugin",
};

const aliasByFolder = Object.fromEntries(
  Object.entries(folderByAlias).map(([alias, folder]) => [folder, alias])
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function runTool(name, args, options) {
  return execFileSync(name, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

const dryRun = process.argv.includes("--dry-run");
const allowDirty = process.argv.includes("--allow-dirty");
const otpArg = process.argv.find((a) => a.startsWith("--otp="));
const otp = otpArg?.slice("--otp=".length) ?? "";
if (otpArg && !/^\d{6,8}$/.test(otp)) {
  console.error("Invalid --otp= value (expected 6–8 digits)");
  process.exit(1);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyFolders = onlyArg
  ? onlyArg
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((alias) => folderByAlias[alias] ?? alias)
  : null;

function publishArgs() {
  // Native git checks cannot run while we temporarily rewrite workspace:* → ^version.
  // Traceability: clean+tagged origin/main guards + stamped gitHead.
  const args = ["publish", "--access", "public", "--no-git-checks"];
  if (dryRun) args.push("--dry-run");
  if (otp) args.push(`--otp=${otp}`);
  return args;
}

function assertNpmAuth() {
  if (dryRun) return;
  try {
    runTool("npm", ["whoami"], { cwd: root, stdio: "pipe" });
  } catch {
    console.error(`
npm publish failed: not logged in to https://registry.npmjs.org/

  1. npm login
  2. Ensure your npm user can publish the @telemetry-tracker scope
  3. pnpm publish:packages -- --otp=123456   (if 2FA is enabled)

Dry run (no login): pnpm publish:dry
`);
    process.exit(1);
  }
}

function resolvePublishSet() {
  if (!onlyFolders) {
    return { publishCore: true, dependents: allDependents };
  }
  const publishCore = onlyFolders.includes(coreName);
  const dependents = allDependents.filter((name) => onlyFolders.includes(name));
  const unknown = onlyFolders.filter(
    (name) => name !== coreName && !allDependents.includes(name)
  );
  if (unknown.length) {
    console.error(`Unknown --only package(s): ${unknown.join(", ")}`);
    process.exit(1);
  }
  return { publishCore, dependents };
}

function folderAlias(folderName) {
  return aliasByFolder[folderName] ?? folderName.replace(/^telemetry-/, "");
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

try {
  assertAllowDirtyPolicy({ dryRun, allowDirty });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

assertNpmAuth();

const skipSafetyForDryDirty = dryRun && allowDirty;
let headSha = "unknown";
let headTags = [];

if (skipSafetyForDryDirty) {
  console.warn(
    "\nWARNING: --dry-run --allow-dirty skips clean/tag/origin checks (local dry run only).\n"
  );
} else {
  try {
    assertCleanWorkingTree(root);
    ({ sha: headSha, tags: headTags } = assertHeadIsTagged(root));
    assertHeadMatchesOriginMain(root, { headSha });
    const remoteTagMap = loadOriginTagMap(root);
    // Validate remote presence for every tag on HEAD that looks like an SDK release tag.
    const sdkTagsOnHead = headTags.filter(
      (t) => t.startsWith("sdk-") || t.startsWith("@telemetry-tracker/")
    );
    assertTagsPushedToOrigin({
      tags: sdkTagsOnHead.length ? sdkTagsOnHead : headTags,
      headSha,
      remoteTagMap,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  console.log(`\nPublish from origin/main ${headSha}`);
  console.log(`Tags on HEAD: ${headTags.join(", ")}\n`);
}

const { publishCore, dependents } = resolvePublishSet();
const packagesToPublish = [
  ...(publishCore ? [coreName] : []),
  ...dependents,
];

const corePkgPath = join(packagesDir, coreName, "package.json");
const coreVersion = readJson(corePkgPath).version;
console.log(`${coreName} version: ${coreVersion}\n`);

// Per-package version tags must exist on HEAD (skipped only for dry-run --allow-dirty).
if (!skipSafetyForDryDirty) {
  for (const folderName of packagesToPublish) {
    const pkg = readJson(join(packagesDir, folderName, "package.json"));
    try {
      assertPackageReleaseTag({
        tags: headTags,
        packageName: pkg.name,
        version: pkg.version,
        folderAlias: folderAlias(folderName),
      });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }
}

function publishPackage(folderName, mutatePkg) {
  const pkgPath = join(packagesDir, folderName, "package.json");
  const original = readJson(pkgPath);
  const working = mutatePkg
    ? mutatePkg(structuredClone(original))
    : structuredClone(original);
  const toPublish =
    headSha === "unknown" ? working : stampGitHead(working, headSha);

  try {
    assertNoWorkspaceProtocolDeps(toPublish);
  } catch (err) {
    writeJson(pkgPath, original);
    throw err;
  }

  writeJson(pkgPath, toPublish);
  const env = {
    ...process.env,
    [SDK_RELEASE_PUBLISH_ENV]: "1",
  };
  try {
    runTool("pnpm", publishArgs(), {
      cwd: join(packagesDir, folderName),
      stdio: "inherit",
      env,
    });
    return true;
  } catch {
    return false;
  } finally {
    writeJson(pkgPath, original);
  }
}

let failed = false;

if (publishCore) {
  let ok = false;
  try {
    ok = publishPackage(coreName);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    ok = false;
  }
  if (!ok) {
    fail(
      `${coreName} publish failed; aborting so dependents (e.g. node) are not published against a missing core.`
    );
  }
}

for (const name of dependents) {
  let ok = false;
  try {
    ok = publishPackage(name, (pkg) => {
      if (pkg.dependencies && typeof pkg.dependencies[coreDep] === "string") {
        pkg.dependencies[coreDep] = `^${coreVersion}`;
      }
      return pkg;
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    ok = false;
  }
  if (!ok) {
    console.error(`\n${name} publish failed.\n`);
    failed = true;
    break;
  }
}

if (failed) {
  process.exit(1);
}

console.log("\nDone.");
