import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { API_VERSION } from "../generated/api-version.js";
import {
  buildHealthResponse,
  isHealthCheckDatabaseEnabled,
  isHealthDetailedEnabled,
  resolveApiVersion,
} from "./health.js";

describe("resolveApiVersion", () => {
  const prev = process.env.TELEMETRY_API_VERSION;

  afterEach(() => {
    if (prev === undefined) delete process.env.TELEMETRY_API_VERSION;
    else process.env.TELEMETRY_API_VERSION = prev;
  });

  it("prefers TELEMETRY_API_VERSION when set", () => {
    process.env.TELEMETRY_API_VERSION = "1.6.2";
    expect(resolveApiVersion()).toBe("1.6.2");
  });

  it("uses build-time API_VERSION when env is unset", () => {
    delete process.env.TELEMETRY_API_VERSION;
    expect(resolveApiVersion()).toBe(API_VERSION);
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$|^dev$/);
  });
});

describe("health env flags", () => {
  const prevDb = process.env.HEALTH_CHECK_DATABASE;
  const prevDetailed = process.env.HEALTH_DETAILED;

  afterEach(() => {
    if (prevDb === undefined) delete process.env.HEALTH_CHECK_DATABASE;
    else process.env.HEALTH_CHECK_DATABASE = prevDb;
    if (prevDetailed === undefined) delete process.env.HEALTH_DETAILED;
    else process.env.HEALTH_DETAILED = prevDetailed;
  });

  it("isHealthCheckDatabaseEnabled is true only when env is true", () => {
    delete process.env.HEALTH_CHECK_DATABASE;
    expect(isHealthCheckDatabaseEnabled()).toBe(false);
    process.env.HEALTH_CHECK_DATABASE = "true";
    expect(isHealthCheckDatabaseEnabled()).toBe(true);
  });

  it("isHealthDetailedEnabled is true only when env is true", () => {
    delete process.env.HEALTH_DETAILED;
    expect(isHealthDetailedEnabled()).toBe(false);
    process.env.HEALTH_DETAILED = "true";
    expect(isHealthDetailedEnabled()).toBe(true);
  });
});

describe("buildHealthResponse", () => {
  const prevDb = process.env.HEALTH_CHECK_DATABASE;
  const prevDetailed = process.env.HEALTH_DETAILED;
  const prevVersion = process.env.TELEMETRY_API_VERSION;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.TELEMETRY_EMAIL_FROM;

  beforeEach(() => {
    delete process.env.HEALTH_CHECK_DATABASE;
    delete process.env.HEALTH_DETAILED;
    process.env.TELEMETRY_API_VERSION = "1.6.2-test";
    delete process.env.RESEND_API_KEY;
    delete process.env.TELEMETRY_EMAIL_FROM;
  });

  afterEach(() => {
    if (prevDb === undefined) delete process.env.HEALTH_CHECK_DATABASE;
    else process.env.HEALTH_CHECK_DATABASE = prevDb;
    if (prevDetailed === undefined) delete process.env.HEALTH_DETAILED;
    else process.env.HEALTH_DETAILED = prevDetailed;
    if (prevVersion === undefined) delete process.env.TELEMETRY_API_VERSION;
    else process.env.TELEMETRY_API_VERSION = prevVersion;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.TELEMETRY_EMAIL_FROM;
    else process.env.TELEMETRY_EMAIL_FROM = prevFrom;
  });

  function mockPrisma(queryImpl: () => Promise<unknown>): PrismaClient {
    return {
      $queryRaw: vi.fn(queryImpl),
    } as unknown as PrismaClient;
  }

  it("returns version and email without database fields by default", async () => {
    const { statusCode, body } = await buildHealthResponse(mockPrisma(async () => 1));
    expect(statusCode).toBe(200);
    expect(body).toEqual({
      ok: true,
      version: "1.6.2-test",
      email: "not_configured",
    });
  });

  it("includes database latency when HEALTH_CHECK_DATABASE=true", async () => {
    process.env.HEALTH_CHECK_DATABASE = "true";
    const { statusCode, body } = await buildHealthResponse(mockPrisma(async () => 1));
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.database).toBe("ok");
    expect(body.database_latency_ms).toEqual(expect.any(Number));
    expect(body.database_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns 503 when database probe fails", async () => {
    process.env.HEALTH_CHECK_DATABASE = "true";
    const { statusCode, body } = await buildHealthResponse(
      mockPrisma(async () => {
        throw new Error("connection refused");
      })
    );
    expect(statusCode).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.database).toBe("unavailable");
    expect(body.database_latency_ms).toEqual(expect.any(Number));
  });

  it("adds uptime and node_version when HEALTH_DETAILED=true", async () => {
    process.env.HEALTH_DETAILED = "true";
    const { body } = await buildHealthResponse(mockPrisma(async () => 1));
    expect(body.uptime_seconds).toEqual(expect.any(Number));
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.node_version).toMatch(/^v\d+/);
  });

  it("does not expose secrets in detailed mode", async () => {
    process.env.HEALTH_DETAILED = "true";
    process.env.HEALTH_CHECK_DATABASE = "true";
    process.env.RESEND_API_KEY = "re_secret";
    process.env.TELEMETRY_EMAIL_FROM = "Telemetry <noreply@example.com>";
    const { body } = await buildHealthResponse(mockPrisma(async () => 1));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("re_secret");
    expect(body.email).toBe("configured");
  });
});
