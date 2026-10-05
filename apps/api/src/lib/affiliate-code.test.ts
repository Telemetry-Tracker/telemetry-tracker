import { describe, expect, it } from "vitest";
import {
  isValidAffiliateCode,
  normalizeAffiliateCode,
  parseAffiliateCode,
  slugifyAffiliateCode,
} from "./affiliate-code.js";

describe("affiliate-code", () => {
  it("normalizes case-insensitively", () => {
    expect(normalizeAffiliateCode("  AlIce ")).toBe("alice");
  });

  it("accepts valid public codes", () => {
    expect(isValidAffiliateCode("alice")).toBe(true);
    expect(isValidAffiliateCode("bob-2")).toBe(true);
    expect(isValidAffiliateCode("A_1")).toBe(true);
  });

  it("rejects invalid, short, or UUID codes", () => {
    expect(isValidAffiliateCode("a")).toBe(false);
    expect(isValidAffiliateCode("has space")).toBe(false);
    expect(isValidAffiliateCode("-leading")).toBe(false);
    expect(isValidAffiliateCode("00000000-0000-4000-8000-000000000001")).toBe(false);
    expect(parseAffiliateCode("not a code!")).toBeNull();
  });

  it("slugifies names into codes", () => {
    expect(slugifyAffiliateCode("Alice Partner")).toBe("alice-partner");
    expect(slugifyAffiliateCode("!!!")).toBe("aff");
  });
});
