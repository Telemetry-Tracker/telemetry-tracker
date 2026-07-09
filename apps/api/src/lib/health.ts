import type { PrismaClient } from "@prisma/client";
import { API_VERSION } from "../generated/api-version.js";
import { isTransactionalEmailConfigured } from "./email.js";

const processStartedAt = Date.now();

export type HealthResponse = {
  ok: boolean;
  version: string;
  email: "configured" | "not_configured";
  database?: "ok" | "unavailable";
  database_latency_ms?: number;
  uptime_seconds?: number;
  node_version?: string;
};

export function isHealthCheckDatabaseEnabled(): boolean {
  return process.env.HEALTH_CHECK_DATABASE === "true";
}

export function isHealthDetailedEnabled(): boolean {
  return process.env.HEALTH_DETAILED === "true";
}

/** Deploy tag or build-time release version — safe for public `/health`. */
export function resolveApiVersion(): string {
  const fromEnv = process.env.TELEMETRY_API_VERSION?.trim();
  if (fromEnv) return fromEnv;
  return API_VERSION;
}

async function probeDatabase(
  prisma: PrismaClient
): Promise<{ database: "ok" | "unavailable"; database_latency_ms: number }> {
  const start = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      database: "ok",
      database_latency_ms: Math.round(performance.now() - start),
    };
  } catch {
    return {
      database: "unavailable",
      database_latency_ms: Math.round(performance.now() - start),
    };
  }
}

/** Build the public `/health` JSON body and HTTP status code. */
export async function buildHealthResponse(
  prisma: PrismaClient
): Promise<{ statusCode: 200 | 503; body: HealthResponse }> {
  const body: HealthResponse = {
    ok: true,
    version: resolveApiVersion(),
    email: isTransactionalEmailConfigured() ? "configured" : "not_configured",
  };

  if (isHealthCheckDatabaseEnabled()) {
    const db = await probeDatabase(prisma);
    body.database = db.database;
    body.database_latency_ms = db.database_latency_ms;
    body.ok = db.database === "ok";
  }

  if (isHealthDetailedEnabled()) {
    body.uptime_seconds = Math.floor((Date.now() - processStartedAt) / 1000);
    body.node_version = process.version;
  }

  return { statusCode: body.ok ? 200 : 503, body };
}
