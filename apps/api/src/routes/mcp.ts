import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateMcp, consumeMcpRate, mcpEnabled } from "../lib/mcp-auth.js";
import { isIngestPiiScrubEnabled } from "../lib/ingest-pii-scrub.js";
import { buildMcpServer } from "../lib/mcp-tools.js";
import { prisma } from "../lib/db.js";

export async function mcpRoutes(app: FastifyInstance) {
  app.route({ method: ["GET", "DELETE"], url: "/mcp", handler: async (_req, reply) => reply.code(mcpEnabled() ? 405 : 404).header("Allow", "POST").send({ error: "Stateless MCP uses POST only" }) });
  app.post("/mcp", { bodyLimit: 16 * 1024 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!mcpEnabled() || !isIngestPiiScrubEnabled()) return reply.code(404).send({ error: "Agent access disabled" });
    // MCP is for native clients; reject browser origins to avoid DNS rebinding/cross-site access.
    if (req.headers.origin) return reply.code(403).send({ error: "Browser origins are not supported" });
    const auth = await authenticateMcp(req.headers.authorization);
    if (!auth) return reply.code(401).send({ error: "Invalid read token" });
    if (!(await consumeMcpRate(auth))) return reply.code(429).header("Retry-After", "60").send({ error: "Agent request limit exceeded" });
    await prisma.mcpReadToken.update({ where: { id: auth.token.id }, data: { last_used_at: new Date(), usage_count: { increment: 1 } } });
    const server = buildMcpServer(auth);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      reply.hijack();
      reply.raw.setHeader("Cache-Control", "no-store");
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } finally {
      await transport.close();
      await server.close();
    }
  });
}
