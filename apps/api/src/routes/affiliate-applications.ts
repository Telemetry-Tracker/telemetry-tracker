/**
 * Public affiliate program application endpoint (POST /api/affiliate-applications).
 * No session. 404 when the affiliate flag is off. Per-IP rate limit + global hourly cap,
 * server-side validation, honeypot, and dedupe of repeat pending applications by email.
 */
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { prisma } from "../lib/db.js";
import { isAffiliateFeatureEnabled } from "../lib/affiliates-feature-flag.js";
import {
  APPLICATION_RATE_LIMIT_WINDOW_MS,
  applicationRateLimitKey,
  applicationRateLimitMax,
  isHoneypotTripped,
  notifyFounderOfApplication,
  parseAffiliateApplicationInput,
  submitAffiliateApplication,
} from "../lib/affiliate-application.js";

const SUCCESS_MESSAGE =
  "Thanks — your application is in. We review every application by hand and will reach out if it's a fit.";

export async function affiliateApplicationRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  app.post(
    "/affiliate-applications",
    {
      config: {
        rateLimit: {
          max: applicationRateLimitMax(),
          timeWindow: APPLICATION_RATE_LIMIT_WINDOW_MS,
          keyGenerator: (request) => applicationRateLimitKey(request),
          errorResponseBuilder: (_request, context) => ({
            statusCode: 429,
            error: "Too many applications from this network. Try again later.",
            retryAfter: context.after,
          }),
        },
      },
    },
    async (request, reply) => {
      if (!isAffiliateFeatureEnabled()) {
        return reply.status(404).send({ error: "Not found" });
      }
      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : {};

      // Bots that fill the hidden field get the normal success response; nothing is stored.
      if (isHoneypotTripped(body)) {
        return reply.send({ ok: true, message: SUCCESS_MESSAGE });
      }

      const parsed = parseAffiliateApplicationInput(body);
      if (!parsed.ok) {
        return reply.status(400).send({ error: "Please fix the highlighted fields.", fields: parsed.fields });
      }

      const result = await submitAffiliateApplication(prisma, parsed.value);
      if (result.kind === "over_capacity") {
        return reply
          .status(429)
          .send({ error: "We're receiving a lot of applications right now. Try again in an hour." });
      }
      if (result.kind === "created") {
        void notifyFounderOfApplication(parsed.value, request.log);
      }
      // Same response for new and duplicate pending applications (no email enumeration).
      return reply.send({ ok: true, message: SUCCESS_MESSAGE });
    }
  );
}
