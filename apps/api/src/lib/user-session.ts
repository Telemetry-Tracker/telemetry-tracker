import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { sessionDeviceFromUserAgent } from "./session-device.js";

export const SESSION_DAYS = 30;

export function readRequestUserAgent(request: FastifyRequest): string | undefined {
  const userAgent = request.headers["user-agent"];
  return typeof userAgent === "string" ? userAgent : undefined;
}

export async function createUserSession(
  userId: string,
  request: FastifyRequest
): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const device = sessionDeviceFromUserAgent(readRequestUserAgent(request));
  await prisma.userSession.create({
    data: {
      id: sessionId,
      user_id: userId,
      expires_at: expiresAt,
      user_agent: device.userAgent ?? null,
      device_browser: device.deviceBrowser ?? null,
      device_os: device.deviceOs ?? null,
    },
  });
  return { sessionId, expiresAt };
}
