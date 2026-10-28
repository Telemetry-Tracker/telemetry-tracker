import { describe, expect, it } from "vitest";
import {
  isStaleProductLine,
  previousLineClosedByOpeningTag,
  compareReleaseVersion,
  formatMinorLineLabel,
  parseProductMilestoneTitle,
  parseReleaseVersion,
  resolveLineCloseVersions,
  shouldSendProductUpdateEmail,
} from "./release-email-semver.js";

describe("parseReleaseVersion", () => {
  it("parses tags with or without v prefix", () => {
    expect(parseReleaseVersion("v1.5.18")).toEqual({ major: 1, minor: 5, patch: 18 });
    expect(parseReleaseVersion("1.5.18")).toEqual({ major: 1, minor: 5, patch: 18 });
  });

  it("rejects invalid versions", () => {
    expect(parseReleaseVersion("v1.5")).toBeNull();
    expect(parseReleaseVersion("latest")).toBeNull();
  });
});

describe("compareReleaseVersion", () => {
  it("orders semver tuples", () => {
    expect(compareReleaseVersion({ major: 1, minor: 6, patch: 0 }, { major: 1, minor: 5, patch: 18 })).toBeGreaterThan(
      0
    );
    expect(compareReleaseVersion({ major: 1, minor: 5, patch: 0 }, { major: 1, minor: 6, patch: 0 })).toBeLessThan(0);
  });
});

describe("formatMinorLineLabel", () => {
  it("formats X.Y from a release", () => {
    expect(formatMinorLineLabel({ major: 1, minor: 15, patch: 4 })).toBe("1.15");
  });
});

describe("parseProductMilestoneTitle", () => {
  it("parses vX.Y.x product milestones", () => {
    expect(parseProductMilestoneTitle("v1.16.x — Release Intelligence")).toEqual({
      major: 1,
      minor: 16,
      lineLabel: "1.16",
    });
    expect(parseProductMilestoneTitle("v1.15.x - Alert Rules")).toEqual({
      major: 1,
      minor: 15,
      lineLabel: "1.15",
    });
    expect(parseProductMilestoneTitle("1.14.x — Notifications")).toEqual({
      major: 1,
      minor: 14,
      lineLabel: "1.14",
    });
  });

  it("ignores unrelated milestones", () => {
    expect(parseProductMilestoneTitle("Q3 marketing")).toBeNull();
    expect(parseProductMilestoneTitle("v1.16.0 — too specific")).toBeNull();
    expect(parseProductMilestoneTitle("v1.16.xtra — false friend")).toBeNull();
    expect(parseProductMilestoneTitle("Release Intelligence")).toBeNull();
  });

  it("accepts a bare vX.Y.x title", () => {
    expect(parseProductMilestoneTitle("v1.16.x")).toEqual({
      major: 1,
      minor: 16,
      lineLabel: "1.16",
    });
  });
});

describe("resolveLineCloseVersions", () => {
  const tags = [
    "v1.14.4",
    "v1.15.0",
    "v1.15.9",
    "v1.16.0",
    "v1.16.7",
    "not-a-tag",
    "v2.0.0",
  ];

  it("picks latest tag on the closed minor and previous minor final", () => {
    expect(resolveLineCloseVersions(tags, 1, 16)).toEqual({
      ok: true,
      version: "1.16.7",
      previousVersion: "1.15.9",
      lineLabel: "1.16",
    });
  });

  it("uses latest prior major when closing X.0", () => {
    expect(resolveLineCloseVersions(tags, 2, 0)).toEqual({
      ok: true,
      version: "2.0.0",
      previousVersion: "1.16.7",
      lineLabel: "2.0",
    });
  });

  it("fails safely when the minor line has no tags", () => {
    expect(resolveLineCloseVersions(tags, 1, 99)).toEqual({
      ok: false,
      error: expect.stringContaining("no semver tags found for minor line 1.99"),
    });
  });

  it("allows bootstrap when there is no previous minor", () => {
    expect(resolveLineCloseVersions(["v1.0.0", "v1.0.1"], 1, 0)).toEqual({
      ok: true,
      version: "1.0.1",
      previousVersion: null,
      lineLabel: "1.0",
    });
  });
});

describe("shouldSendProductUpdateEmail", () => {
  it("skips first tag without lineClose", () => {
    const d = shouldSendProductUpdateEmail("1.5.0", null);
    expect(d.send).toBe(false);
    expect(d.reason).toContain("line_close");
  });

  it("sends first tag with lineClose", () => {
    const d = shouldSendProductUpdateEmail("1.5.0", null, { lineClose: true });
    expect(d.send).toBe(true);
    expect(d.reason).toContain("line close of 1.5");
  });

  it("skips opening a new major line", () => {
    const d = shouldSendProductUpdateEmail("2.0.0", "1.5.18");
    expect(d.send).toBe(false);
    expect(d.reason).toContain("crossed minor/major");
  });

  it("skips opening a new minor line", () => {
    const d = shouldSendProductUpdateEmail("1.6.0", "1.5.18");
    expect(d.send).toBe(false);
    expect(d.reason).toContain("crossed minor/major");
  });

  it("skips mid-line patch-only releases", () => {
    const d = shouldSendProductUpdateEmail("1.5.18", "1.5.17");
    expect(d.send).toBe(false);
    expect(d.reason).toContain("patch-only");
  });

  it("sends on line close for a final patch of the minor", () => {
    const d = shouldSendProductUpdateEmail("1.15.4", "1.14.4", { lineClose: true });
    expect(d.send).toBe(true);
    expect(d.reason).toContain("line close of 1.15");
  });

  it("rejects line close when previous_version is on the same minor line", () => {
    const d = shouldSendProductUpdateEmail("1.15.4", "1.15.3", { lineClose: true });
    expect(d.send).toBe(false);
    expect(d.reason).toContain("same minor line");
  });

  it("sends on line close when closing the only .0 of a line", () => {
    const d = shouldSendProductUpdateEmail("1.15.0", "1.14.4", { lineClose: true });
    expect(d.send).toBe(true);
    expect(d.reason).toContain("line close of 1.15");
  });

  it("skips semver downgrades even with lineClose", () => {
    const d = shouldSendProductUpdateEmail("1.5.0", "1.6.0", { lineClose: true });
    expect(d.send).toBe(false);
    expect(d.reason).toContain("not a forward semver release");
  });

  it("skips invalid previous tags", () => {
    const d = shouldSendProductUpdateEmail("1.6.0", "not-a-version");
    expect(d.send).toBe(false);
    expect(d.reason).toContain("invalid previous tag");
  });
});

describe("previousLineClosedByOpeningTag", () => {
  const tags = ["v1.20.0", "v1.20.2", "v1.21.0", "v1.22.0", "v1.22.1"];

  it("returns the previous minor line for a new .0 tag", () => {
    expect(previousLineClosedByOpeningTag([...tags, "v1.23.0"], "v1.23.0")).toEqual({
      major: 1,
      minor: 22,
      lineLabel: "1.22",
    });
  });

  it("handles a major bump", () => {
    expect(previousLineClosedByOpeningTag([...tags, "v2.0.0"], "v2.0.0")?.lineLabel).toBe("1.22");
  });

  it("skips patch tags", () => {
    expect(previousLineClosedByOpeningTag(tags, "v1.22.1")).toBeNull();
  });

  it("skips the very first line", () => {
    expect(previousLineClosedByOpeningTag(["v1.0.0"], "v1.0.0")).toBeNull();
  });
});

describe("isStaleProductLine", () => {
  const tags = ["v1.18.7", "v1.19.1", "v1.20.2", "v1.21.0", "v1.22.1"];

  it("allows the latest and most recently completed lines", () => {
    expect(isStaleProductLine(tags, 1, 22)).toBe(false);
    expect(isStaleProductLine(tags, 1, 21)).toBe(false);
  });

  it("flags older lines as historical", () => {
    expect(isStaleProductLine(tags, 1, 20)).toBe(true);
    expect(isStaleProductLine(tags, 1, 18)).toBe(true);
  });
});
