import { describe, expect, it } from "vitest";
import { sharePct } from "./visits-summary.js";

describe("sharePct", () => {
  it("returns 0 when there is nothing to share", () => {
    expect(sharePct(0, 0)).toBe(0);
    expect(sharePct(3, 0)).toBe(0);
    expect(sharePct(0, 10)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(sharePct(1, 3)).toBe(33.3);
    expect(sharePct(2, 2)).toBe(100);
  });
});
