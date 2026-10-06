// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./request-client-ip";

describe("clientIpFromHeaders", () => {
  it("prefers x-real-ip, then the first x-forwarded-for hop", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "203.0.113.5"
    );
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "2001:db8::2" }))).toBe("2001:db8::2");
  });

  it("ignores missing or malformed values", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "not-an-ip" }))).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "unknown, 1.2.3.4" }))).toBeNull();
  });
});
