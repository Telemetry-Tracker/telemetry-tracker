import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("GET /health with database check (integration)", () => {
  let app: FastifyInstance | undefined;
  let prevHealth: string | undefined;

  let prevResend: string | undefined;
  let prevEmailFrom: string | undefined;

  beforeAll(async () => {
    prevHealth = process.env.HEALTH_CHECK_DATABASE;
    prevResend = process.env.RESEND_API_KEY;
    prevEmailFrom = process.env.TELEMETRY_EMAIL_FROM;
    process.env.HEALTH_CHECK_DATABASE = "true";
    delete process.env.RESEND_API_KEY;
    delete process.env.TELEMETRY_EMAIL_FROM;
    app = await createApp();
  });

  afterAll(async () => {
    if (prevHealth === undefined) delete process.env.HEALTH_CHECK_DATABASE;
    else process.env.HEALTH_CHECK_DATABASE = prevHealth;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
    if (prevEmailFrom === undefined) delete process.env.TELEMETRY_EMAIL_FROM;
    else process.env.TELEMETRY_EMAIL_FROM = prevEmailFrom;
    if (app) await app.close();
  });

  it("returns 200 and database ok when HEALTH_CHECK_DATABASE=true", async () => {
    const res = await app!.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      database: string;
      database_latency_ms: number;
      email: string;
      version: string;
    };
    expect(body.ok).toBe(true);
    expect(body.database).toBe("ok");
    expect(body.email).toBe("not_configured");
    expect(body.version).toBeTruthy();
    expect(body.database_latency_ms).toEqual(expect.any(Number));
  });
});
