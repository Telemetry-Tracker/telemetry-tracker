import cors, { type FastifyCorsOptionsDelegateCallback } from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "./lib/db.js";
import { buildHealthResponse } from "./lib/health.js";
import { resolveCorsOptionsForRequest } from "./lib/cors-config.js";
import { genReqId, registerObservabilityHooks } from "./lib/observability.js";
import {
  rateLimitMaxApi,
  rateLimitMaxAuth,
  rateLimitMaxIngest,
  rateLimitMaxPublic,
  RATE_LIMIT_WINDOW_MS,
} from "./lib/rate-limit-env.js";
import { ingestRoutes } from "./routes/ingest.js";
import { apiRoutes } from "./routes/api.js";
import { authRoutes } from "./routes/auth.js";
import { contactRoutes } from "./routes/contact.js";
import { marketingRoutes } from "./routes/marketing.js";
import { projectDashboardRoutes } from "./routes/project-dashboard.js";
import { billingRoutes } from "./routes/billing.js";
import { registerStripeWebhookIfConfigured } from "./routes/stripe-webhook.js";

const PAYLOAD_LIMIT = 200 * 1024; // 200 KB

/**
 * Build the Fastify app (no listen). Used by the server entrypoint and Vitest `inject()`.
 */
export async function createApp(): Promise<FastifyInstance> {
  const isTest = process.env.NODE_ENV === "test";

  const app = Fastify({
    logger: !isTest,
    bodyLimit: PAYLOAD_LIMIT,
    genReqId,
  });

  registerObservabilityHooks(app);

  const corsDelegator: FastifyCorsOptionsDelegateCallback = (req, callback) => {
    callback(null, resolveCorsOptionsForRequest(req));
  };

  await app.register(cors, { delegator: corsDelegator });

  await registerStripeWebhookIfConfigured(app);

  await app.register(
    async function publicSurface(f) {
      await f.register(rateLimit, {
        max: rateLimitMaxPublic(isTest),
        timeWindow: RATE_LIMIT_WINDOW_MS,
      });
      // Set HEALTH_CHECK_DATABASE=true in production (or staging) to verify DB connectivity; omit in dev if you prefer a dependency-free /health.
      // Optional HEALTH_DETAILED=true adds uptime and Node version (no secrets). See DEPLOYMENT.md.
      f.get("/health", async (_req, reply) => {
        const { statusCode, body } = await buildHealthResponse(prisma);
        return reply.code(statusCode).send(body);
      });
      f.get("/", async (_req, reply) =>
        reply.code(200).send({ service: "telemetry-api", ok: true })
      );
    }
  );

  await app.register(
    async function ingestScope(f) {
      await f.register(rateLimit, {
        max: rateLimitMaxIngest(isTest),
        timeWindow: RATE_LIMIT_WINDOW_MS,
      });
      await f.register(ingestRoutes);
    },
    { prefix: "/ingest" }
  );

  await app.register(
    async function authScope(f) {
      await f.register(rateLimit, {
        max: rateLimitMaxAuth(isTest),
        timeWindow: RATE_LIMIT_WINDOW_MS,
      });
      await f.register(authRoutes);
    },
    { prefix: "/api" }
  );

  await app.register(
    async function contactScope(f) {
      await f.register(rateLimit, {
        max: rateLimitMaxPublic(isTest),
        timeWindow: RATE_LIMIT_WINDOW_MS,
      });
      await f.register(contactRoutes);
      await f.register(marketingRoutes);
    },
    { prefix: "/api" }
  );

  await app.register(
    async function apiScope(f) {
      await f.register(rateLimit, {
        max: rateLimitMaxApi(isTest),
        timeWindow: RATE_LIMIT_WINDOW_MS,
      });
      await f.register(apiRoutes);
      await f.register(projectDashboardRoutes);
      await f.register(billingRoutes);
    },
    { prefix: "/api" }
  );

  return app;
}
