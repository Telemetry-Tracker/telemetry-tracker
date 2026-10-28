import { describe, it, expect } from "vitest";
import { normalizeEmailForSelfReferralCheck } from "./affiliate-email-normalize.js";

describe("normalizeEmailForSelfReferralCheck", () => {
  it("lowercases email", () => {
    expect(normalizeEmailForSelfReferralCheck("Alice@Example.COM")).toBe(
      "alice@example.com"
    );
  });

  it("strips +tag from local part", () => {
    expect(normalizeEmailForSelfReferralCheck("user+tag@example.com")).toBe(
      "user@example.com"
    );
    expect(normalizeEmailForSelfReferralCheck("alice+test+multiple@example.com")).toBe(
      "alice@example.com"
    );
  });

  it("removes dots from Gmail addresses", () => {
    expect(normalizeEmailForSelfReferralCheck("al.ice@gmail.com")).toBe(
      "alice@gmail.com"
    );
    expect(normalizeEmailForSelfReferralCheck("a.l.i.c.e@gmail.com")).toBe(
      "alice@gmail.com"
    );
    expect(normalizeEmailForSelfReferralCheck("test.user@googlemail.com")).toBe(
      "testuser@gmail.com"
    );
  });

  it("does not remove dots from non-Gmail addresses", () => {
    expect(normalizeEmailForSelfReferralCheck("al.ice@example.com")).toBe(
      "al.ice@example.com"
    );
    expect(normalizeEmailForSelfReferralCheck("a.b.c@protonmail.com")).toBe(
      "a.b.c@protonmail.com"
    );
  });

  it("combines +tag and Gmail dots normalization", () => {
    expect(normalizeEmailForSelfReferralCheck("al.ice+tag@gmail.com")).toBe(
      "alice@gmail.com"
    );
    expect(normalizeEmailForSelfReferralCheck("A.L.I.C.E+test@Gmail.COM")).toBe(
      "alice@gmail.com"
    );
  });

  it("handles edge cases", () => {
    expect(normalizeEmailForSelfReferralCheck("  test@example.com  ")).toBe(
      "test@example.com"
    );
    expect(normalizeEmailForSelfReferralCheck("no-at-sign")).toBe("no-at-sign");
    expect(normalizeEmailForSelfReferralCheck("@nodomain")).toBe("@nodomain");
  });

  it("returns predictable results for self-referral pairs", () => {
    const variations = [
      "alice@gmail.com",
      "Alice@gmail.com",
      "al.ice@gmail.com",
      "alice+tag@gmail.com",
      "Al.Ice+test@Gmail.COM",
      "al.ice+tag@googlemail.com",
    ];

    const normalized = variations.map(normalizeEmailForSelfReferralCheck);
    const expected = "alice@gmail.com";

    normalized.forEach((n) => {
      expect(n).toBe(expected);
    });
  });
});
