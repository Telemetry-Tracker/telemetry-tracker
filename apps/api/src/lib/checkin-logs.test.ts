import { afterEach, expect, it, vi } from "vitest";
import { sanitizeSentryEvent } from "./sentry-privacy.js";
import { createApp } from "../app.js";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("redacts check-in credentials from real Fastify request, error and arbitrary logs", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((line) => { lines.push(String(line)); return true; });
  const app = await createApp();
  const token = `ttc_${"a".repeat(64)}`;
  app.get("/test-checkin-error", async () => { throw new Error(`Request failed at /checkin/${token}/start`); });
  await app.inject(`/checkin/${token}/unsupported`);
  await app.inject({ url: "/checkin/unsupported", headers: { "x-tt-checkin-token": token, authorization: `Bearer ${token}` } });
  await app.inject("/test-checkin-error");
  app.log.info({ deep: { credential: token } }, `secret=${token}`);
  await app.close();
  const log = lines.join("");
  expect(log).toContain("[redacted]"); expect(log).not.toContain(token); expect(log).not.toContain("x-tt-checkin-token"); expect(log).not.toContain("authorization");
  for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
});

it("removes check-in and bearer headers from Sentry even for malformed tokens", () => {
  const event = { request: { headers: { "X-TT-Checkin-Token": "malformed-secret", Authorization: "Bearer malformed-secret", accept: "text/plain" } } };
  expect(sanitizeSentryEvent(event).request.headers).toEqual({ accept: "text/plain" });
});
