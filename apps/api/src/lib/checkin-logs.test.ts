import { afterEach, expect, it, vi } from "vitest";
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
  await app.inject("/test-checkin-error");
  app.log.info({ deep: { credential: token } }, `secret=${token}`);
  await app.close();
  const log = lines.join("");
  expect(log).toContain("[redacted]"); expect(log).not.toContain(token);
  for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
});
