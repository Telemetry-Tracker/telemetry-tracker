import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashApiKeySecret } from "./api-key-auth.js";
import { createApiKeyWithPlanLimitCheck } from "./plan-enforcement.js";

export type GeneratedApiKey = {
  fullKey: string;
  publicId: string;
  name: string | null;
  allowedApp: string | null;
  sourceMapUpload: boolean;
};

export function generateApiKeyMaterial(): {
  publicId: string;
  secret: string;
  secretHash: string;
  fullKey: string;
} {
  const publicId = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const secretHash = hashApiKeySecret(publicId, secret);
  const fullKey = `tt_live_${publicId}_${secret}`;
  return { publicId, secret, secretHash, fullKey };
}

/** Insert an active API key when under plan limits. Returns the full secret once. */
export async function createProjectApiKey(
  prisma: PrismaClient,
  projectId: string,
  options?: { name?: string | null; allowedApp?: string | null; sourceMapUpload?: boolean }
): Promise<
  | { ok: true; key: GeneratedApiKey }
  | { ok: false; error: string; code?: string }
> {
  const { publicId, secretHash, fullKey } = generateApiKeyMaterial();
  const name =
    options?.name !== undefined && options.name !== null && options.name.trim() !== ""
      ? options.name.trim().slice(0, 120)
      : null;
  let allowedApp: string | null = null;
  if (options?.allowedApp && options.allowedApp.trim() !== "") {
    allowedApp = options.allowedApp.trim().slice(0, 64);
  }

  const created = await createApiKeyWithPlanLimitCheck(prisma, projectId, {
    public_id: publicId,
    secret_hash: secretHash,
    name,
    allowed_app: allowedApp,
    source_map_upload: options?.sourceMapUpload === true,
  });

  if (!created.ok) {
    return { ok: false, error: created.error, code: created.code };
  }

  return {
    ok: true,
    key: {
      fullKey,
      publicId,
      name,
      allowedApp,
      sourceMapUpload: options?.sourceMapUpload === true,
    },
  };
}
