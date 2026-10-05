/**
 * Founder-only affiliate review routes (AFFILIATE_ADMIN_EMAILS).
 */
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import Stripe from "stripe";
import { prisma } from "../lib/db.js";
import { requireAffiliateAdmin } from "../lib/affiliate-admin.js";
import { resolveNeedsAttentionAsValid } from "../lib/resolve-needs-attention.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

export async function affiliatesAdminRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  app.post<{
    Params: { orgId: string };
    Body: { reason?: string; affiliateId?: string };
  }>(
    "/meta/affiliates/organizations/:orgId/resolve-needs-attention",
    async (request, reply) => {
      const admin = await requireAffiliateAdmin(request, reply);
      if (!admin) return;

      const orgId = request.params.orgId.trim();
      if (!UUID_RE.test(orgId)) {
        return reply.status(400).send({ error: "Invalid organization id" });
      }

      const body = (request.body ?? {}) as { reason?: unknown; affiliateId?: unknown };
      const reason = typeof body.reason === "string" ? body.reason : "";
      const affiliateId =
        typeof body.affiliateId === "string" ? body.affiliateId.trim() : undefined;

      const result = await resolveNeedsAttentionAsValid(prisma, stripeClient(), {
        organizationId: orgId,
        actorUserId: admin.userId,
        actorEmail: admin.email,
        reason,
        confirmAffiliateId: affiliateId || undefined,
      });

      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "Organization referral not found" });
      }
      if (result.kind === "refused") {
        const status = result.code === "invalid_reason" ? 400 : 409;
        return reply.status(status).send({ error: result.message, code: result.code });
      }

      return reply.send({
        resolved: true,
        idempotent: result.idempotent,
        fromStatus: result.fromStatus,
        toStatus: result.toStatus,
        needsAttention: result.needsAttention,
        affiliateId: result.affiliateId,
        customerId: result.customerId,
        stripe: result.stripe,
      });
    }
  );
}
