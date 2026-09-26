/**
 * Pre-flight checks for SDK npm publishes.
 * Used by scripts/publish-packages.mjs so releases only run from a clean,
 * tagged origin/main checkout that can be traced to an exact commit (via gitHead).
 */
import { execFileSync } from "node:child_process";

export function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Fail when the working tree has uncommitted changes. */
export function assertCleanWorkingTree(cwd, { statusPorcelain } = {}) {
  const status =
    statusPorcelain ??
    execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
    });
  if (status.trim().length > 0) {
    throw new Error(
      `Refusing to publish: working tree is dirty.\n` +
        `SDK publishes must run from a clean checkout of a release tag.\n` +
        status.trim()
    );
  }
}

/**
 * Fail unless HEAD has at least one tag. Returns the primary tag name and SHA.
 * Prefer an exact tag pointing at HEAD (not an ancestor-only describe).
 */
export function assertHeadIsTagged(cwd, { headSha, tagsAtHead } = {}) {
  const sha =
    headSha ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const tags =
    tagsAtHead ??
    execFileSync("git", ["tag", "--points-at", "HEAD"], {
      cwd,
      encoding: "utf8",
    })
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

  if (tags.length === 0) {
    throw new Error(
      `Refusing to publish: HEAD ${sha.slice(0, 12)} is not tagged.\n` +
        `Create and push SDK release tags (e.g. sdk-core-v1.5.0) on the origin/main ` +
        `release commit, then publish from that checkout so npm gitHead matches the tag.`
    );
  }

  return { sha, tags };
}

/**
 * Expected release tags for a package version on HEAD.
 * Accepts `sdk-<alias>-v<version>` or `<npmName>@<version>`.
 */
export function expectedReleaseTags(packageName, version, folderAlias) {
  return [`sdk-${folderAlias}-v${version}`, `${packageName}@${version}`];
}

/** Fail unless HEAD carries a tag that matches this package version. */
export function assertPackageReleaseTag({
  tags,
  packageName,
  version,
  folderAlias,
}) {
  const candidates = expectedReleaseTags(packageName, version, folderAlias);
  if (!candidates.some((t) => tags.includes(t))) {
    throw new Error(
      `Refusing to publish ${packageName}@${version}: HEAD is missing a matching release tag.\n` +
        `Expected one of: ${candidates.join(", ")}\n` +
        `Tags on HEAD: ${tags.length ? tags.join(", ") : "(none)"}`
    );
  }
}

/** Fail unless HEAD is exactly origin/main (the production release commit). */
export function assertHeadMatchesOriginMain(
  cwd,
  { headSha, originMainSha } = {}
) {
  const head =
    headSha ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  let main = originMainSha;
  if (main == null) {
    try {
      main = execFileSync("git", ["rev-parse", "origin/main"], {
        cwd,
        encoding: "utf8",
      }).trim();
    } catch {
      throw new Error(
        `Refusing to publish: could not resolve origin/main.\n` +
          `Fetch main first: git fetch origin main`
      );
    }
  }
  if (head !== main) {
    throw new Error(
      `Refusing to publish: HEAD ${head.slice(0, 12)} is not origin/main (${main.slice(0, 12)}).\n` +
        `SDK npm publishes must run from the tagged release commit on main.`
    );
  }
  return { head, main };
}

/**
 * Fail unless each required tag exists on the remote pointing at HEAD.
 * `remoteTagMap` is Map<tagName, sha> (injectable for tests).
 */
export function assertTagsPushedToOrigin({
  tags,
  headSha,
  remoteTagMap,
}) {
  const missing = [];
  const mismatched = [];
  for (const tag of tags) {
    const remoteSha = remoteTagMap.get(tag);
    if (!remoteSha) {
      missing.push(tag);
      continue;
    }
    if (remoteSha !== headSha) {
      mismatched.push(`${tag}→${remoteSha.slice(0, 12)}`);
    }
  }
  if (missing.length || mismatched.length) {
    const parts = [];
    if (missing.length) parts.push(`missing on origin: ${missing.join(", ")}`);
    if (mismatched.length) {
      parts.push(`pointing at another commit: ${mismatched.join(", ")}`);
    }
    throw new Error(
      `Refusing to publish: release tags are not pushed to origin at HEAD ${headSha.slice(0, 12)}.\n` +
        parts.join("\n")
    );
  }
}

/** Parse `git ls-remote --tags origin` output into Map<tag, sha>. */
export function parseLsRemoteTags(stdout) {
  const map = new Map();
  for (const line of String(stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, ref] = trimmed.split(/\s+/);
    if (!sha || !ref?.startsWith("refs/tags/")) continue;
    // Prefer peeled annotated tags (^{}) when present.
    const name = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    const isPeeled = ref.endsWith("^{}");
    if (isPeeled || !map.has(name)) {
      map.set(name, sha);
    }
  }
  return map;
}

export function loadOriginTagMap(cwd) {
  const stdout = execFileSync("git", ["ls-remote", "--tags", "origin"], {
    cwd,
    encoding: "utf8",
  });
  return parseLsRemoteTags(stdout);
}

/** Reject package.json that still has workspace: protocol deps (unsafe for npm). */
export function assertNoWorkspaceProtocolDeps(pkg) {
  const sections = ["dependencies", "optionalDependencies", "peerDependencies"];
  const bad = [];
  for (const section of sections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        bad.push(`${section}.${name}=${range}`);
      }
    }
  }
  if (bad.length) {
    throw new Error(
      `Refusing to publish ${pkg.name ?? "package"}: workspace: protocol deps must be rewritten first.\n` +
        bad.join("\n")
    );
  }
}

/** --allow-dirty is dry-run only; never for a real publish. */
export function assertAllowDirtyPolicy({ dryRun, allowDirty }) {
  if (allowDirty && !dryRun) {
    throw new Error(
      `Refusing to publish: --allow-dirty cannot bypass safety checks for a real publish.\n` +
        `Use --dry-run --allow-dirty only for local dry runs.`
    );
  }
}

/** Stamp npm's gitHead field so the published tarball traces to this commit. */
export function stampGitHead(pkg, sha) {
  return { ...pkg, gitHead: sha };
}

/**
 * Env gate for package prepublishOnly — set by publish-packages.mjs only.
 * Prevents `pnpm publish` / `npm publish` from a package folder bypassing guards.
 */
export const SDK_RELEASE_PUBLISH_ENV = "TELEMETRY_SDK_RELEASE_PUBLISH";

export function assertSdkReleasePublishEnv(env = process.env) {
  if (env[SDK_RELEASE_PUBLISH_ENV] !== "1") {
    throw new Error(
      `Refusing to publish: direct npm/pnpm publish from a package folder is blocked.\n` +
        `Use the root script from a clean tagged origin/main checkout:\n` +
        `  pnpm publish:packages -- --only=core,node,vite-plugin`
    );
  }
}
