import type { FastifyInstance } from "fastify";

/** Baseline browser/API hardening headers (no CSP — responses are JSON/binary, not HTML pages). */
export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-permitted-cross-domain-policies": "none",
} as const;

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (reply.getHeader(name) === undefined) {
        reply.header(name, value);
      }
    }
    return payload;
  });
}
