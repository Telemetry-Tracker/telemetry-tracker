import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCleanWorkingTree,
  assertHeadIsTagged,
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

describe("stampGitHead", () => {
  it("adds gitHead without dropping other fields", () => {
    assert.deepEqual(stampGitHead({ name: "x", version: "1.0.0" }, "abc"), {
      name: "x",
      version: "1.0.0",
      gitHead: "abc",
    });
  });
});
