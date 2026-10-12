// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clientIpFromHeaders } from "./request-client-ip";
import { CLOUDFLARE_CIDRS } from "./cloudflare-ip";

describe("clientIpFromHeaders", () => {
  it("uses Railway identity and ignores spoofed visitor/XFF headers", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.5", "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("203.0.113.5");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBeNull();
  });
  it("accepts visitors only behind Cloudflare, including mapped IPv6", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "::ffff:104.16.0.1", "cf-connecting-ip": "2001:db8::2" }))).toBe("2001:db8:0:0:0:0:0:2");
  });
  it("rejects malformed or multiple values safely", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "1.1.1.1, 2.2.2.2" }))).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "104.16.0.1", "cf-connecting-ip": "1.1.1.1, 2.2.2.2" }))).toBe("104.16.0.1");
  });
  it("keeps the embedded API and dashboard CIDR lists identical", () => {
    const api = readFileSync(new URL("../../api/src/lib/client-ip.ts", import.meta.url), "utf8");
    const list = api.split("export const CLOUDFLARE_CIDRS = [")[1].split("] as const")[0];
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...CLOUDFLARE_CIDRS]);
  });
});
