import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";

describe("API smoke", () => {
  let app: FastifyInstance;
  let prevHealthCheck: string | undefined;

  beforeAll(async () => {
    prevHealthCheck = process.env.HEALTH_CHECK_DATABASE;
    delete process.env.HEALTH_CHECK_DATABASE;
    app = await createApp();
  });

  afterAll(async () => {
    if (prevHealthCheck === undefined) delete process.env.HEALTH_CHECK_DATABASE;
    else process.env.HEALTH_CHECK_DATABASE = prevHealthCheck;
    await app.close();
  });

  it("GET /health returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; email: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.email).toMatch(/^configured|not_configured$/);
    expect(body.version).toBeTruthy();
  });

  it("POST /ingest/event without API key returns 401", async () => {
    const prev = process.env.INGEST_ALLOW_UNAUTHENTICATED;
    delete process.env.INGEST_ALLOW_UNAUTHENTICATED;
    try {
      const res = await app.inject({
        method: "POST",
        url: "/ingest/event",
        payload: {
          app: "test-app",
          name: "test-event",
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { error?: string };
      expect(body.error).toBeDefined();
    } finally {
      if (prev !== undefined) {
        process.env.INGEST_ALLOW_UNAUTHENTICATED = prev;
      }
    }
  });

  it("POST /api/project/source-maps accepts bodies larger than the global 200 KB limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/project/source-maps",
      payload: {
        app: "web",
        release: "1.0.0",
        bundle_url: "https://cdn.example/app.js",
        content: "x".repeat(300 * 1024),
      },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).not.toBe(413);
  });

  it("OPTIONS /ingest/event allows arbitrary browser origins in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevCors = process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://telemetry-tracker.com";

    try {
      const prodApp = await createApp();
      const res = await prodApp.inject({
        method: "OPTIONS",
        url: "/ingest/event",
        headers: {
          origin: "https://customer-app.example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      await prodApp.close();
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "https://customer-app.example.com"
      );
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevCors === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prevCors;
    }
  });

  it("OPTIONS /api/auth/me rejects unknown origins in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevCors = process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://telemetry-tracker.com";

    try {
      const prodApp = await createApp();
      const res = await prodApp.inject({
        method: "OPTIONS",
        url: "/api/auth/me",
        headers: {
          origin: "https://customer-app.example.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });
      await prodApp.close();
      expect(res.statusCode).toBe(404);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevCors === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prevCors;
    }
  });

  it("GET /api/meta/projects returns 401 without session in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowReads = process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS;
    process.env.NODE_ENV = "production";
    delete process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS;

    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/meta/projects",
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { error?: string };
      expect(body.error).toBe("Unauthorized");
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevAllowReads === undefined) delete process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS;
      else process.env.TELEMETRY_ALLOW_UNAUTHENTICATED_READS = prevAllowReads;
    }
  });
});
