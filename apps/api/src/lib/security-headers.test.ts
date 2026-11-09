import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerSecurityHeaders, SECURITY_HEADERS } from "./security-headers.js";

describe("security-headers", () => {
  it("sets baseline headers on responses", async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get("/probe", async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[name]).toBe(value);
    }
    await app.close();
  });

  it("does not overwrite an explicitly set header", async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get("/framed", async (_req, reply) => {
      reply.header("x-frame-options", "SAMEORIGIN");
      return { ok: true };
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/framed" });
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });
});
