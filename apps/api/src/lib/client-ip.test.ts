import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOUDFLARE_CIDRS, clientIpKeyGenerator, ingestKeyGenerator, isCloudflareIp, registerIpDiagnostics, resolveClientIp, resolveClientIpDetails } from "./client-ip.js";
import { applicationRateLimitKey } from "./affiliate-application.js";

const env = { TRUST_RAILWAY_EDGE: "true" };
const request = (headers: Record<string, string | string[] | undefined> = {}, ip = "10.0.0.1") => ({ ip, headers });
afterEach(() => vi.unstubAllEnvs());

describe("client IP trust chain", () => {
  it("embeds all published IPv4 and IPv6 networks and matches their boundaries", () => {
    expect(CLOUDFLARE_CIDRS).toHaveLength(22);
    for (const cidr of CLOUDFLARE_CIDRS) expect(isCloudflareIp(cidr.split("/")[0])).toBe(true);
    expect(isCloudflareIp("104.23.255.255")).toBe(true);
    expect(isCloudflareIp("104.15.255.255")).toBe(false);
    expect(isCloudflareIp("104.28.0.0")).toBe(false);
    expect(isCloudflareIp("2a06:98c7:ffff::1")).toBe(true);
    expect(isCloudflareIp("2a06:98c8::1")).toBe(false);
    expect(isCloudflareIp("::ffff:104.16.0.1")).toBe(true);
    expect(isCloudflareIp("::ffff:6810:1")).toBe(true);
    expect(isCloudflareIp("garbage")).toBe(false);
  });
  it("ignores spoofed headers on direct Railway connections", () => {
    expect(resolveClientIp(request({ "x-real-ip": "203.0.113.1", "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2", "x-envoy-external-address": "3.3.3.3", "x-real-ip-like": "104.16.0.1" }), env)).toBe("203.0.113.1");
  });
  it("uses Cloudflare visitors only behind Cloudflare hops", () => {
    expect(resolveClientIpDetails(request({ "x-real-ip": "104.16.0.1", "cf-connecting-ip": "203.0.113.2" }), env)).toEqual({ ip: "203.0.113.2", source: "cf" });
    expect(resolveClientIpDetails(request({ "x-real-ip": "203.0.113.2" }), env)).toEqual({ ip: "203.0.113.2", source: "railway" });
    expect(resolveClientIp(request({ "x-real-ip": "2606:4700::1", "cf-connecting-ip": "2001:db8::2" }), env)).toBe("2001:db8:0:0:0:0:0:2");
  });
  it.each(["bad", "1.1.1.1, 2.2.2.2", ["1.1.1.1", "2.2.2.2"], "", undefined])("rejects invalid or multiple IPs: %s", (header) => {
    expect(resolveClientIp(request({ "x-real-ip": header, "cf-connecting-ip": "1.1.1.1" }), env)).toBe("10.0.0.1");
    expect(resolveClientIp(request({ "x-real-ip": "104.16.0.1", "cf-connecting-ip": header }), env)).toBe("104.16.0.1");
  });
  it("defaults Railway trust only in production and honors explicit false", () => {
    const req = request({ "x-real-ip": "203.0.113.3" });
    expect(resolveClientIp(req, {})).toBe(req.ip);
    expect(resolveClientIp(req, { NODE_ENV: "production" })).toBe("203.0.113.3");
    expect(resolveClientIp(req, { NODE_ENV: "production", TRUST_RAILWAY_EDGE: "false" })).toBe(req.ip);
  });
  it("normalizes equivalent IPv6 and IPv4-mapped identities", () => {
    expect(resolveClientIp(request({}, "::ffff:203.0.113.1"), {})).toBe("203.0.113.1");
    expect(resolveClientIp(request({}, "2001:0db8::1"), {})).toBe(resolveClientIp(request({}, "2001:db8:0:0:0:0:0:1"), {}));
  });
  it("keeps authenticated affiliate forwarding ahead of the shared resolver", () => {
    const req = request({ "x-real-ip": "203.0.113.3", "x-tt-client-ip": "203.0.113.4", "x-tt-client-ip-secret": "test-secret" });
    expect(applicationRateLimitKey(req, { ...env, AFFILIATE_CLIENT_IP_FORWARD_SECRET: "test-secret" })).toBe("affiliate-application:203.0.113.4");
    expect(applicationRateLimitKey(req, env)).toBe("affiliate-application:203.0.113.3");
  });
});

it.each([clientIpKeyGenerator, ingestKeyGenerator])("enforces shared IP buckets across rotating sockets (%s)", async (keyGenerator) => {
  vi.stubEnv("TRUST_RAILWAY_EDGE", "true");
  const app = Fastify();
  try {
    await app.register(rateLimit, { max: 2, timeWindow: 60000, keyGenerator });
    app.get("/", async () => ({ ok: true }));
    const inject = (socket: string, visitor: string) => app.inject({ url: "/", remoteAddress: socket, headers: { "x-real-ip": "104.16.0.1", "cf-connecting-ip": visitor } });
    expect((await inject("10.0.0.1", "203.0.113.1")).statusCode).toBe(200);
    expect((await inject("10.0.0.2", "203.0.113.1")).statusCode).toBe(200);
    expect((await inject("10.0.0.3", "203.0.113.1")).statusCode).toBe(429);
    expect((await inject("10.0.0.3", "203.0.113.2")).statusCode).toBe(200);
  } finally { await app.close(); }
});

it("isolates ingest keys behind a NAT and unifies Bearer and X-API-Key", async () => {
  vi.stubEnv("TRUST_RAILWAY_EDGE", "true");
  const app = Fastify();
  try {
    await app.register(rateLimit, { max: 1, keyGenerator: ingestKeyGenerator });
    app.get("/", async () => ({}));
    const key = `tt_live_${"a".repeat(32)}_abcd`;
    const headers = { "x-real-ip": "203.0.113.1", "x-api-key": key };
    expect((await app.inject({ url: "/", headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/", headers: { "x-real-ip": "203.0.113.1", authorization: `Bearer ${key}` } })).statusCode).toBe(429);
    expect((await app.inject({ url: "/", headers: { ...headers, "x-api-key": key.replace(/a/g, "b") } })).statusCode).toBe(200);
    expect(ingestKeyGenerator(request(headers))).not.toContain("abcd");
  } finally { await app.close(); }
});

it("logs only the diagnostic allowlist when explicitly enabled", async () => {
  const app = Fastify();
  const info = vi.spyOn(app.log, "info");
  registerIpDiagnostics(app);
  app.get("/", async () => ({}));
  try {
    await app.inject({ url: "/" });
    expect(info.mock.calls.filter((call) => call[1] === "Client IP diagnostic")).toHaveLength(0);
    vi.stubEnv("IP_DIAGNOSTIC_LOG", "true");
    await app.inject({ url: "/", headers: { authorization: "secret", "x-tt-client-ip-secret": "secret", "x-real-ip": "203.0.113.1" } });
    const diagnostics = info.mock.calls.filter((call) => call[1] === "Client IP diagnostic");
    expect(diagnostics).toHaveLength(1);
    expect(Object.keys(diagnostics[0][0] as object).sort()).toEqual(["socketIp", "xRealIp", "xForwardedFor", "cfConnectingIp", "xEnvoyExternalAddress", "resolvedIp", "source"].sort());
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  } finally { await app.close(); }
});
