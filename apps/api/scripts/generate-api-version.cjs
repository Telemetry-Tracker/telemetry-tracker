const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const repoRoot = path.join(apiRoot, "../..");
const outPath = path.join(apiRoot, "src/generated/api-version.ts");

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const CHANGELOG_CANDIDATES = [
  path.join(repoRoot, "CHANGELOG.md"),
  path.join(apiRoot, "CHANGELOG.md"),
  path.join(process.cwd(), "CHANGELOG.md"),
  path.join(process.cwd(), "../../CHANGELOG.md"),
];

function readChangelogVersion() {
  for (const changelogPath of CHANGELOG_CANDIDATES) {
    let content;
    try {
      content = fs.readFileSync(changelogPath, "utf8");
    } catch {
      continue;
    }

    for (const match of content.matchAll(/^## \[([^\]]+)\]/gm)) {
      const version = match[1].trim();
      if (version === "Unreleased") continue;
      if (SEMVER_RE.test(version)) return { version, source: `CHANGELOG (${changelogPath})` };
    }
  }

  return null;
}

function readGitTagVersion() {
  const cwdCandidates = [repoRoot, apiRoot, process.cwd()];
  for (const cwd of cwdCandidates) {
    try {
      const tag = execSync("git describe --tags --match 'v*' --abbrev=0", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const version = tag.replace(/^v/, "");
      if (SEMVER_RE.test(version)) return { version, source: `git tag (${cwd})` };
    } catch {
      /* try next cwd */
    }
  }

  return null;
}

function readExistingGeneratedVersion() {
  try {
    const content = fs.readFileSync(outPath, "utf8");
    const match = content.match(/export const API_VERSION = "([^"]+)"/);
    const version = match?.[1]?.trim();
    if (version && SEMVER_RE.test(version)) {
      return { version, source: "committed api-version.ts" };
    }
  } catch {
    /* no prior generated file */
  }

  return null;
}

function resolveVersion() {
  return (
    readChangelogVersion() ??
    readGitTagVersion() ??
    readExistingGeneratedVersion() ?? { version: "dev", source: "fallback" }
  );
}

const { version, source } = resolveVersion();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `/** Generated at build time from ${source}. Do not edit manually. */\nexport const API_VERSION = "${version}";\n`,
  "utf8"
);

console.log(`[generate-api-version] ${version} (${source})`);
