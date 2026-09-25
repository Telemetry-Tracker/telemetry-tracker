import { createHash, timingSafeEqual } from "node:crypto";
import type { PlanTier, PrismaClient } from "@prisma/client";
import { effectivePlanTierForLimits } from "./effective-plan-tier.js";

/** Full key format: `tt_live_<publicId>_<secret>` (secret is hex, no underscores). */
const KEY_RE = /^tt_live_([a-f0-9]{32})_([a-f0-9]+)$/i;

export function hashApiKeySecret(publicId: string, secret: string): string {
  return createHash("sha256").update(`${publicId}:${secret}`, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export type VerifiedApiKey = {
  id: string;
  projectId: string;
  organizationPlanTier: PlanTier;
  /** If set, ingest payloads must use this `app` value. */
  allowedApp: string | null;
  /** When false, the key may ingest but must not upload source maps. */
  sourceMapUpload: boolean;
};

/**
 * Resolve API key from `Authorization: Bearer ...` or `X-API-Key`.
 * Returns null if missing/invalid/revoked.
 */
export async function verifyIngestApiKey(
  prisma: PrismaClient,
  request: { headers: Record<string, string | string[] | undefined> }
): Promise<VerifiedApiKey | null> {
  const auth = headerFirst(request.headers.authorization);
  const xKey = headerFirst(request.headers["x-api-key"]);
  let token: string | undefined;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  } else if (xKey) {
    token = xKey.trim();
  }
  if (!token) return null;

  const m = KEY_RE.exec(token);
  if (!m) return null;
  const publicId = m[1].toLowerCase();
  const secret = m[2].toLowerCase();

  const row = await prisma.apiKey.findUnique({
    where: { public_id: publicId },
    include: {
      project: {
        include: {
          organization: {
            select: {
              plan_tier: true,
              stripe_subscription_status: true,
              deleted_at: true,
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  if (row.revoked_at || row.deleted_at) return null;
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;
  if (row.project.deleted_at || row.project.organization.deleted_at) {
    return null;
  }

  const expectedHash = hashApiKeySecret(publicId, secret);
  if (!safeEqualHex(row.secret_hash, expectedHash)) {
    return null;
  }

  const org = row.project.organization;
  const tier = effectivePlanTierForLimits(
    org.plan_tier,
    org.stripe_subscription_status
  );
  void prisma.apiKey
    .update({
      where: { id: row.id },
      data: { last_used_at: new Date() },
    })
    .catch(() => {});

  return {
    id: row.id,
    projectId: row.project_id,
    organizationPlanTier: tier,
    allowedApp: row.allowed_app,
    sourceMapUpload: row.source_map_upload,
  };
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
