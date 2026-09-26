#!/usr/bin/env node
/**
 * Publish SDK packages to npm in order: telemetry-core first, then packages that depend on it.
 *
 * Releases must run from a **clean, tagged** checkout. The script stamps `gitHead` on each
 * published package.json so the npm tarball traces to the exact commit (pnpm temporarily
 * rewrites workspace:* deps, so native `npm publish` git checks cannot be used).
 *
 * Examples:
 *   pnpm publish:packages -- --dry-run
 *   pnpm publish:packages -- --only=core,node,vite-plugin --otp=123456
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import {
  assertCleanWorkingTree,
  assertHeadIsTagged,
  stampGitHead,
} from "./lib/publish-guards.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const packagesDir = join(root, "packages");

const coreName = "telemetry-core"; // folder name
const coreDep = "@telemetry-tracker/core"; // package name for dependency
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

/** Run npm/pnpm via execFile. On Windows, shell+PATHEXT resolves .cmd/.exe;
 * args stay argv-safe (no string-concat OTP / flags into a shell command). */
function runTool(name, args, options) {
  return execFileSync(name, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function runOptional(file, args, cwd = root) {
  try {
    runTool(file, args, { cwd, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

const dryRun = process.argv.includes("--dry-run");
const skipGitGuards = process.argv.includes("--allow-dirty");
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
  // Traceability comes from assertCleanWorkingTree + assertHeadIsTagged + stamped gitHead.
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
  2. Ensure your npm user can publish the @telemetry-tracker scope (create org at npmjs.com/org/create if needed)
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

assertNpmAuth();

let headSha = "unknown";
let headTags = [];
if (skipGitGuards) {
  console.warn(
    "\nWARNING: --allow-dirty skips clean/tag guards. Do not use for production publishes.\n"
  );
} else {
  try {
    assertCleanWorkingTree(root);
    ({ sha: headSha, tags: headTags } = assertHeadIsTagged(root));
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
  console.log(`\nPublish from tagged commit ${headSha}`);
  console.log(`Tags: ${headTags.join(", ")}\n`);
}

const { publishCore, dependents } = resolvePublishSet();

// 1. Get core version
const corePkgPath = join(packagesDir, coreName, "package.json");
const coreVersion = readJson(corePkgPath).version;
console.log(`\n${coreName} version: ${coreVersion}\n`);

function publishPackage(folderName, mutatePkg) {
  const pkgPath = join(packagesDir, folderName, "package.json");
  const original = readJson(pkgPath);
  const working = mutatePkg
    ? mutatePkg(structuredClone(original))
    : structuredClone(original);
  const toPublish =
    headSha === "unknown" ? working : stampGitHead(working, headSha);
  writeJson(pkgPath, toPublish);
  try {
    const ok = runOptional("pnpm", publishArgs(), join(packagesDir, folderName));
    if (!ok) console.log(`(${folderName} publish failed or skipped.)\n`);
    return ok;
  } finally {
    writeJson(pkgPath, original);
  }
}

// 2. Publish telemetry-core (continue if already published)
if (publishCore) {
  const corePublished = publishPackage(coreName);
  if (!corePublished) {
    console.log(`\n(${coreName} publish failed or skipped, continuing with dependents…)\n`);
  }
}

// 3. Publish dependents (patch deps, stamp gitHead, publish, restore)
for (const name of dependents) {
  publishPackage(name, (pkg) => {
    if (pkg.dependencies && typeof pkg.dependencies[coreDep] === "string") {
      pkg.dependencies[coreDep] = `^${coreVersion}`;
    }
    return pkg;
  });
}

console.log("\nDone.");
