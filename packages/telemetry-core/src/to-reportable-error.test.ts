import { describe, expect, it } from "vitest";
import { toReportableError } from "./to-reportable-error.js";

describe("toReportableError", () => {
  it("returns Error instances unchanged", () => {
    const err = new Error("keep");
    expect(toReportableError(err)).toBe(err);
  });

  it("normalizes null and undefined", () => {
    expect(toReportableError(null).message).toBe("null");
    expect(toReportableError(undefined).message).toBe("undefined");
  });

  it("normalizes primitives", () => {
    expect(toReportableError("boom").message).toBe("boom");
    expect(toReportableError(42).message).toBe("42");
    expect(toReportableError(true).message).toBe("true");
  });

  it("normalizes plain objects", () => {
    expect(toReportableError({ a: 1 }).message).toBe('{"a":1}');
  });
});
