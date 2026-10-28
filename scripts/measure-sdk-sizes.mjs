#!/usr/bin/env node
/**
 * Measure published JS output for the SDK packages.
 *
 * tsc emit is not minified. This script reports, for each .js file under dist:
 *   raw bytes, gzip of raw, esbuild-minified bytes, gzip of minified.
 *
 * Minify keeps imports external. It does not bundle dependencies
 * (for example web-vitals stays outside @telemetry-tracker/core).
 * Totals are sums of those files, not a single browser bundle.
 * This is not a comparison with any other vendor SDK.
 *
 *   pnpm --filter @telemetry-tracker/core --filter @telemetry-tracker/next --filter @telemetry-tracker/node build
 *   node scripts/measure-sdk-sizes.mjs
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  { name: "@telemetry-tracker/core", dir: "packages/telemetry-core" },
  { name: "@telemetry-tracker/next", dir: "packages/telemetry-next" },
  { name: "@telemetry-tracker/node", dir: "packages/telemetry-node" },
];

function loadEsbuild() {
  const bases = [root, join(root, "apps/dashboard"), join(root, "packages/telemetry-core")];
  for (const base of bases) {
    try {
      return createRequire(join(base, "package.json"))("esbuild");
    } catch {
      // Not a direct dependency of that package.
    }
  }
  // Next.js depends on esbuild; pnpm keeps it in the virtual store rather than
  // linking it at the repo root.
  const pnpmDir = join(root, "node_modules/.pnpm");
  let entries = [];
  try {
    entries = readdirSync(pnpmDir).filter((name) => name.startsWith("esbuild@"));
  } catch {
    entries = [];
  }
  for (const name of entries) {
    const pkgJson = join(pnpmDir, name, "node_modules/esbuild/package.json");
    try {
      return createRequire(pkgJson)("esbuild");
    } catch {
      // Skip a store entry that is not a loadable esbuild package.
    }
  }
  throw new Error(
    "esbuild is not installed. Run pnpm install (Next.js brings it in), then re-run."
  );
}

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...jsFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out.sort();
}

const esbuild = loadEsbuild();
console.log(`esbuild ${esbuild.version}; gzip via node:zlib gzipSync (default level)`);

function pad(value, width) {
  return String(value).padStart(width, " ");
}

let failed = false;

for (const pkg of packages) {
  const dist = join(root, pkg.dir, "dist");
  let files;
  try {
    files = jsFiles(dist);
  } catch {
    console.error(`missing ${relative(root, dist)} — build ${pkg.name} first`);
    failed = true;
    continue;
  }
  if (files.length === 0) {
    console.error(`no .js files in ${relative(root, dist)}`);
    failed = true;
    continue;
  }

  console.log(`\n${pkg.name}`);
  console.log(
    `${"file".padEnd(42)} ${pad("raw", 8)} ${pad("gzip", 8)} ${pad("min", 8)} ${pad("min+gzip", 8)}`
  );

  const totals = { raw: 0, gzip: 0, min: 0, minGzip: 0 };
  for (const file of files) {
    const source = readFileSync(file);
    const raw = source.length;
    const gzip = gzipSync(source).length;
    const minified = esbuild.transformSync(source.toString("utf8"), {
      minify: true,
      legalComments: "none",
      loader: "js",
    });
    const minBuf = Buffer.from(minified.code);
    const min = minBuf.length;
    const minGzip = gzipSync(minBuf).length;
    totals.raw += raw;
    totals.gzip += gzip;
    totals.min += min;
    totals.minGzip += minGzip;
    const label = relative(join(root, pkg.dir), file);
    console.log(
      `${label.padEnd(42)} ${pad(raw, 8)} ${pad(gzip, 8)} ${pad(min, 8)} ${pad(minGzip, 8)}`
    );
  }
  console.log(
    `${"total (sum of files, not a bundle)".padEnd(42)} ${pad(totals.raw, 8)} ${pad(totals.gzip, 8)} ${pad(totals.min, 8)} ${pad(totals.minGzip, 8)}`
  );
}

if (failed) process.exit(1);
