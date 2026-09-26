import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAllowDirtyPolicy,
  assertCleanWorkingTree,
  assertHeadIsTagged,
  assertHeadMatchesOriginMain,
  assertNoWorkspaceProtocolDeps,
  assertPackageReleaseTag,
  assertSdkReleasePublishEnv,
  assertTagsPushedToOrigin,
  expectedReleaseTags,
  parseLsRemoteTags,
  stampGitHead,
} from "./publish-guards.mjs";

describe("assertCleanWorkingTree", () => {
  it("passes when status is empty", () => {
    assert.doesNotThrow(() =>
      assertCleanWorkingTree("/tmp", { statusPorcelain: "" })
    );
  });

  it("throws when status is dirty", () => {
    assert.throws(
      () =>
        assertCleanWorkingTree("/tmp", {
          statusPorcelain: " M packages/telemetry-node/package.json\n",
        }),
      /working tree is dirty/
    );
  });
});

describe("assertHeadIsTagged", () => {
  it("returns sha and tags when HEAD is tagged", () => {
    const result = assertHeadIsTagged("/tmp", {
      headSha: "abc123",
      tagsAtHead: ["sdk-core-v1.5.0", "sdk-node-v1.4.0"],
    });
    assert.deepEqual(result, {
      sha: "abc123",
      tags: ["sdk-core-v1.5.0", "sdk-node-v1.4.0"],
    });
  });

  it("throws when HEAD has no tags", () => {
    assert.throws(
      () => assertHeadIsTagged("/tmp", { headSha: "deadbeef", tagsAtHead: [] }),
      /is not tagged/
    );
  });
});

describe("assertPackageReleaseTag", () => {
  it("accepts sdk-alias-vVERSION or name@VERSION", () => {
    assert.doesNotThrow(() =>
      assertPackageReleaseTag({
        tags: ["sdk-core-v1.5.0"],
        packageName: "@telemetry-tracker/core",
        version: "1.5.0",
        folderAlias: "core",
      })
    );
    assert.doesNotThrow(() =>
      assertPackageReleaseTag({
        tags: ["@telemetry-tracker/node@1.4.0"],
        packageName: "@telemetry-tracker/node",
        version: "1.4.0",
        folderAlias: "node",
      })
    );
  });

  it("throws when version tag is missing", () => {
    assert.throws(
      () =>
        assertPackageReleaseTag({
          tags: ["sdk-core-v1.4.0"],
          packageName: "@telemetry-tracker/core",
          version: "1.5.0",
          folderAlias: "core",
        }),
      /missing a matching release tag/
    );
  });

  it("lists expected tag names", () => {
    assert.deepEqual(expectedReleaseTags("@telemetry-tracker/core", "1.5.0", "core"), [
      "sdk-core-v1.5.0",
      "@telemetry-tracker/core@1.5.0",
    ]);
  });
});

describe("assertHeadMatchesOriginMain", () => {
  it("passes when HEAD equals origin/main", () => {
    assert.deepEqual(
      assertHeadMatchesOriginMain("/tmp", {
        headSha: "aaa",
        originMainSha: "aaa",
      }),
      { head: "aaa", main: "aaa" }
    );
  });

  it("throws when HEAD differs from origin/main", () => {
    assert.throws(
      () =>
        assertHeadMatchesOriginMain("/tmp", {
          headSha: "aaa",
          originMainSha: "bbb",
        }),
      /is not origin\/main/
    );
  });
});

describe("assertTagsPushedToOrigin", () => {
  it("passes when remote tags match HEAD", () => {
    assert.doesNotThrow(() =>
      assertTagsPushedToOrigin({
        tags: ["sdk-core-v1.5.0"],
        headSha: "abc",
        remoteTagMap: new Map([["sdk-core-v1.5.0", "abc"]]),
      })
    );
  });

  it("throws when tags are missing or mismatched on origin", () => {
    assert.throws(
      () =>
        assertTagsPushedToOrigin({
          tags: ["sdk-core-v1.5.0", "sdk-node-v1.4.0"],
          headSha: "abc",
          remoteTagMap: new Map([["sdk-core-v1.5.0", "zzz"]]),
        }),
      /not pushed to origin/
    );
  });
});

describe("parseLsRemoteTags", () => {
  it("prefers peeled annotated tag SHAs", () => {
    const map = parseLsRemoteTags(`
aaa\trefs/tags/sdk-core-v1.5.0
bbb\trefs/tags/sdk-core-v1.5.0^{}
`);
    assert.equal(map.get("sdk-core-v1.5.0"), "bbb");
  });
});

describe("assertNoWorkspaceProtocolDeps", () => {
  it("passes without workspace: ranges", () => {
    assert.doesNotThrow(() =>
      assertNoWorkspaceProtocolDeps({
        name: "@telemetry-tracker/node",
        dependencies: { "@telemetry-tracker/core": "^1.5.0" },
      })
    );
  });

  it("throws when workspace: remains", () => {
    assert.throws(
      () =>
        assertNoWorkspaceProtocolDeps({
          name: "@telemetry-tracker/node",
          dependencies: { "@telemetry-tracker/core": "workspace:*" },
        }),
      /workspace: protocol/
    );
  });
});

describe("assertAllowDirtyPolicy", () => {
  it("allows dirty only with dry-run", () => {
    assert.doesNotThrow(() =>
      assertAllowDirtyPolicy({ dryRun: true, allowDirty: true })
    );
    assert.throws(
      () => assertAllowDirtyPolicy({ dryRun: false, allowDirty: true }),
      /cannot bypass safety checks for a real publish/
    );
  });
});

describe("assertSdkReleasePublishEnv", () => {
  it("requires TELEMETRY_SDK_RELEASE_PUBLISH=1", () => {
    assert.throws(() => assertSdkReleasePublishEnv({}), /direct npm\/pnpm publish/);
    assert.doesNotThrow(() =>
      assertSdkReleasePublishEnv({ TELEMETRY_SDK_RELEASE_PUBLISH: "1" })
    );
  });
});

describe("stampGitHead", () => {
  it("adds gitHead without dropping other fields", () => {
    assert.deepEqual(stampGitHead({ name: "x", version: "1.0.0" }, "abc"), {
      name: "x",
      version: "1.0.0",
      gitHead: "abc",
    });
  });
});
