import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./lib/db.js";

vi.mock("./lib/db.js", () => ({
  prisma: { mcpReadToken: { findUnique: vi.fn(async () => null) } },
}));

describe("MCP pre-auth rate limit", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([undefined, `Bearer tt_read_${"a".repeat(32)}_${"b".repeat(64)}`])(
    "limits unauthenticated requests before further token lookups (%s)",
    async (authorization) => {
      vi.stubEnv("RATE_LIMIT_MAX_MCP", "2");
      vi.stubEnv("TELEMETRY_MCP_ENABLED", "true");
      vi.stubEnv("TELEMETRY_INGEST_PII_SCRUB", "true");
      app = await createApp();
      const request = () => app!.inject({
        method: "POST",
        url: "/mcp",
        headers: authorization ? { authorization } : {},
        payload: {},
      });
      expect((await request()).statusCode).toBe(401);
      expect((await request()).statusCode).toBe(401);
      const lookups = vi.mocked(prisma.mcpReadToken.findUnique).mock.calls.length;
      expect(lookups).toBe(authorization ? 2 : 0);
      const limited = await request();
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      expect(prisma.mcpReadToken.findUnique).toHaveBeenCalledTimes(lookups);
      // The encapsulated MCP bucket does not consume other scopes' allowances.
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
  );

  it("preserves 404 when MCP is disabled", async () => {
    vi.stubEnv("TELEMETRY_MCP_ENABLED", "false");
    app = await createApp();
    expect((await app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(404);
    expect(prisma.mcpReadToken.findUnique).not.toHaveBeenCalled();
  });
});
