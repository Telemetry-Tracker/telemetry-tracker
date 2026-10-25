import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

vi.mock("./lib/rate-limit-env.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/rate-limit-env.js")>(),
  rateLimitMaxPublic: () => 2,
  rateLimitMaxAuth: () => 2,
  rateLimitMaxApi: () => 2,
  rateLimitMaxIngest: () => 2,
  rateLimitMaxMcp: () => 2,
}));
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["GET", "/health"],
  ["POST", "/api/auth/login"],
  ["GET", "/api/overview"],
  ["POST", "/api/contact"],
  ["POST", "/ingest/event"],
  ["POST", "/mcp"],
] as const)("wires shared client identity into %s %s", async (method, url) => {
  vi.stubEnv("TRUST_RAILWAY_EDGE", "true");
  const app = await createApp();
  try {
    const inject = (socket: string, visitor: string) => app.inject({ method, url, remoteAddress: socket, headers: { "x-real-ip": "104.16.0.1", "cf-connecting-ip": visitor } });
    expect((await inject("10.0.0.1", "203.0.113.1")).statusCode).not.toBe(429);
    expect((await inject("10.0.0.2", "203.0.113.1")).statusCode).not.toBe(429);
    expect((await inject("10.0.0.3", "203.0.113.1")).statusCode).toBe(429);
    expect((await inject("10.0.0.3", "203.0.113.2")).statusCode).not.toBe(429);
  } finally { await app.close(); }
});

it("uses trusted visitor identity for the check-in scope", async () => {
  vi.stubEnv("TRUST_RAILWAY_EDGE", "true");
  const app = await createApp();
  const inject = (socket: string, visitor: string) => app.inject({ url: "/checkin", remoteAddress: socket, headers: { "x-real-ip": "104.16.0.1", "cf-connecting-ip": visitor } });
  try {
    for (let i = 0; i < 600; i++) expect((await inject(i % 2 ? "10.0.0.1" : "10.0.0.2", "203.0.113.1")).statusCode).toBe(404);
    expect((await inject("10.0.0.3", "203.0.113.1")).statusCode).toBe(429);
    expect((await inject("10.0.0.3", "203.0.113.2")).statusCode).toBe(404);
  } finally { await app.close(); }
});
