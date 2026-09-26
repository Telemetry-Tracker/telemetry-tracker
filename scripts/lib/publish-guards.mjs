/**
 * Pre-flight checks for SDK npm publishes.
 * Used by scripts/publish-packages.mjs so releases only run from a clean,
 * tagged checkout that can be traced to an exact commit (via gitHead).
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
        `Create and push an SDK release tag (e.g. sdk-core-v1.5.0) on a clean commit, ` +
        `then publish from that checkout so npm gitHead matches the tag.`
    );
  }

  return { sha, tags };
}

/** Stamp npm's gitHead field so the published tarball traces to this commit. */
export function stampGitHead(pkg, sha) {
  return { ...pkg, gitHead: sha };
}
