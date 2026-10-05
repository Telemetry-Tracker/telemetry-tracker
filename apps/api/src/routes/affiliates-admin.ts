/**
 * Founder-only affiliate admin routes (AFFILIATE_ADMIN_EMAILS).
 */
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import Stripe from "stripe";
import { prisma } from "../lib/db.js";
import { requireAffiliateAdmin } from "../lib/affiliate-admin.js";
import {
  createAffiliate,
  getAffiliateDetailForAdmin,
  listAffiliatesForAdmin,
  updateAffiliate,
} from "../lib/affiliate-management.js";
import { markAffiliatePayoutPaid } from "../lib/affiliate-payout.js";
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
  app.get("/meta/affiliates", async (request, reply) => {
    const admin = await requireAffiliateAdmin(request, reply);
    if (!admin) return;
    const affiliates = await listAffiliatesForAdmin(prisma);
    return reply.send({ affiliates });
  });

  app.post("/meta/affiliates", async (request, reply) => {
    const admin = await requireAffiliateAdmin(request, reply);
    if (!admin) return;
    const body = (request.body ?? {}) as {
      name?: unknown;
      email?: unknown;
      code?: unknown;
    };
    const result = await createAffiliate(prisma, {
      name: typeof body.name === "string" ? body.name : "",
      email: typeof body.email === "string" ? body.email : null,
      code: typeof body.code === "string" ? body.code : null,
    });
    if (result.kind === "refused") {
      const status = result.code === "code_taken" ? 409 : 400;
      return reply.status(status).send({ error: result.message, code: result.code });
    }
    return reply.status(201).send({ id: result.id, code: result.code });
  });

  app.get<{ Params: { affiliateId: string } }>(
    "/meta/affiliates/:affiliateId",
    async (request, reply) => {
      const admin = await requireAffiliateAdmin(request, reply);
      if (!admin) return;
      const affiliateId = request.params.affiliateId.trim();
      if (!UUID_RE.test(affiliateId)) {
        return reply.status(400).send({ error: "Invalid affiliate id" });
      }
      const detail = await getAffiliateDetailForAdmin(prisma, affiliateId);
      if (!detail) return reply.status(404).send({ error: "Affiliate not found" });
      return reply.send(detail);
    }
  );

  app.patch<{ Params: { affiliateId: string } }>(
    "/meta/affiliates/:affiliateId",
    async (request, reply) => {
      const admin = await requireAffiliateAdmin(request, reply);
      if (!admin) return;
      const affiliateId = request.params.affiliateId.trim();
      if (!UUID_RE.test(affiliateId)) {
        return reply.status(400).send({ error: "Invalid affiliate id" });
      }
      const body = (request.body ?? {}) as {
        name?: unknown;
        email?: unknown;
        state?: unknown;
      };
      const result = await updateAffiliate(prisma, affiliateId, {
        name: typeof body.name === "string" ? body.name : undefined,
        email: typeof body.email === "string" || body.email === null ? (body.email as string | null) : undefined,
        state: body.state === "active" || body.state === "disabled" ? body.state : undefined,
      });
      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "Affiliate not found" });
      }
      if (result.kind === "refused") {
        return reply.status(400).send({ error: result.message });
      }
      return reply.send({ updated: true });
    }
  );

  app.post<{ Params: { affiliateId: string } }>(
    "/meta/affiliates/:affiliateId/payouts",
    async (request, reply) => {
      const admin = await requireAffiliateAdmin(request, reply);
      if (!admin) return;
      const affiliateId = request.params.affiliateId.trim();
      if (!UUID_RE.test(affiliateId)) {
        return reply.status(400).send({ error: "Invalid affiliate id" });
      }
      const body = (request.body ?? {}) as {
        commissionIds?: unknown;
        adjustmentIds?: unknown;
        amountCents?: unknown;
        paidAt?: unknown;
        referenceNote?: unknown;
        idempotencyKey?: unknown;
      };
      const commissionIds = Array.isArray(body.commissionIds)
        ? body.commissionIds.filter((id): id is string => typeof id === "string")
        : [];
      const adjustmentIds = Array.isArray(body.adjustmentIds)
        ? body.adjustmentIds.filter((id): id is string => typeof id === "string")
        : [];
      const amountCents = typeof body.amountCents === "number" ? body.amountCents : NaN;
      if (!Number.isInteger(amountCents)) {
        return reply.status(400).send({ error: "amountCents must be an integer" });
      }
      const paidAt =
        typeof body.paidAt === "string" && body.paidAt.trim()
          ? new Date(body.paidAt)
          : undefined;
      if (paidAt && Number.isNaN(paidAt.getTime())) {
        return reply.status(400).send({ error: "paidAt must be an ISO timestamp" });
      }

      const result = await markAffiliatePayoutPaid(prisma, {
        affiliateId,
        actorUserId: admin.userId,
        commissionIds,
        adjustmentIds,
        amountCents,
        paidAt,
        referenceNote: typeof body.referenceNote === "string" ? body.referenceNote : null,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      });

      if (result.kind === "not_found") {
        return reply.status(404).send({ error: "Affiliate not found" });
      }
      if (result.kind === "refused") {
        const status = result.code === "already_paid" ? 409 : 400;
        return reply.status(status).send({ error: result.message, code: result.code });
      }
      return reply.send({
        payoutId: result.payoutId,
        amountCents: result.amountCents,
        idempotent: result.idempotent,
      });
    }
  );

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
