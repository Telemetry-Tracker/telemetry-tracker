import { recordFirstTelemetry } from "../lib/signup-funnel.js";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { createIngestAuthPreHandler, requireIngestProjectId } from "../middleware/ingest-auth.js";
import { assertIngestPlanOrReply } from "../lib/plan-enforcement.js";
import { addIngestUnits } from "../lib/usage-meter.js";
import { notifyNewErrorGroupEmail } from "../lib/notification-email-dispatch.js";
import { maybeNotifyErrorSpike } from "../lib/error-spike-alert.js";
import { maybeEvaluateAlertRules } from "../lib/alert-rules.js";
import { maybeNotifyQuotaAlerts } from "../lib/quota-alert.js";
import { computeFingerprint, findOrCreateErrorGroup } from "../services/errors.js";
import { findIngestSession } from "../lib/ingest-session.js";
import {
  ingestAppSchema,
  normalizeMapAppLabel,
  normalizeMapReleaseLabel,
} from "../lib/source-map-artifact.js";
import {
  scrubIngestErrorFields,
  scrubIngestEventFields,
  scrubIngestSessionUserEmail,
} from "../lib/ingest-pii-scrub.js";
import {
  loadProjectPiiDenyKeys,
  loadProjectPiiScrubSettings,
} from "../lib/project-pii-scrub-cache.js";
import { normalizeIngestEnvironment } from "../lib/ingest-environment.js";

/**
 * Ingest pipeline (implement in order):
 * 1. Organization / 2. Project / 3. ApiKey — Prisma schema
 * 4. Ingest auth middleware — `createIngestAuthPreHandler`
 * 5. `project_id` on all writes — below
 * 6. Usage metering — `addIngestUnits` (basic monthly rollup)
 */

const eventSchema = z.object({
  app: ingestAppSchema,
  platform: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  name: z.string().min(1),
  user_id: z.string().optional(),
  session_id: z.string().optional(),
  anonymous_id: z.string().optional(),
  sdk_version: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
});

const sessionSchema = z.object({
  session_id: z.string().min(1),
  app: ingestAppSchema,
  platform: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  user_id: z.string().optional(),
  user_email: z.string().optional().nullable(),
  anonymous_id: z.string().optional(),
  country: z.string().max(8).optional().nullable(),
  device_browser: z.string().max(64).optional().nullable(),
  device_os: z.string().max(64).optional().nullable(),
  sdk_version: z.string().optional(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional().nullable(),
  identity_updated_at: z.string().datetime().optional().nullable(),
});

function sessionContextPatch(
  body: z.infer<typeof sessionSchema>,
  scrubSessionUserEmail = false
): {
  user_id?: string | null;
  user_email?: string | null;
  anonymous_id?: string | null;
  country?: string | null;
  device_browser?: string | null;
  device_os?: string | null;
  sdk_version?: string | null;
  platform?: string | null;
  environment?: string | null;
  release?: string | null;
} {
  const patch: ReturnType<typeof sessionContextPatch> = {};
  if (body.user_id !== undefined) patch.user_id = body.user_id ?? null;
  if (body.user_email !== undefined) {
    const scrubbed = scrubIngestSessionUserEmail(
      body.user_email ?? null,
      scrubSessionUserEmail
    );
    patch.user_email = scrubbed === undefined ? null : scrubbed;
  }
  if (body.anonymous_id !== undefined) patch.anonymous_id = body.anonymous_id ?? null;
  if (body.country !== undefined) patch.country = body.country ?? null;
  if (body.device_browser !== undefined) patch.device_browser = body.device_browser ?? null;
  if (body.device_os !== undefined) patch.device_os = body.device_os ?? null;
  if (body.sdk_version !== undefined) patch.sdk_version = body.sdk_version ?? null;
  if (body.platform !== undefined) patch.platform = body.platform ?? null;
  if (body.environment !== undefined) {
    patch.environment = normalizeIngestEnvironment(body.environment);
  }
  if (body.release !== undefined) patch.release = body.release ?? null;
  return patch;
}

const errorSchema = z.object({
  app: ingestAppSchema,
  platform: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  message: z.string().min(1),
  stack: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  session_id: z.string().optional(),
  user_id: z.string().optional(),
  anonymous_id: z.string().optional(),
  sdk_version: z.string().optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).max(100),
});

const APP_RESTRICT_MSG =
  "This API key is restricted to a specific app label; send a matching `app` field.";

function assertIngestAppAllowed(
  request: FastifyRequest,
  app: string,
  reply: FastifyReply
): boolean {
  const allowed = request.ingestApiKeyAllowedApp;
  if (allowed == null) return true;
  if (normalizeMapAppLabel(app) !== normalizeMapAppLabel(allowed)) {
    void reply.status(403).send({ error: APP_RESTRICT_MSG });
    return false;
  }
  return true;
}

export async function ingestRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  app.addHook("preHandler", createIngestAuthPreHandler(prisma));

  app.post("/event", async (request, reply) => {
    const projectId = requireIngestProjectId(request);
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const denyKeys = await loadProjectPiiDenyKeys(prisma, projectId);
    const body = scrubIngestEventFields(parsed.data, process.env, { denyKeys });
    const app = body.app;
    if (!assertIngestAppAllowed(request, app, reply)) return;
    const planOk = await assertIngestPlanOrReply(prisma, projectId, 1, [app]);
    if (!planOk.ok) return reply.status(planOk.status).send(planOk.body);
    await prisma.event.create({
      data: {
        project_id: projectId,
        app,
        platform: body.platform ?? null,
        environment: normalizeIngestEnvironment(body.environment),
        release: body.release ?? null,
        name: body.name,
        user_id: body.user_id ?? null,
        session_id: body.session_id ?? null,
        anonymous_id: body.anonymous_id ?? null,
        sdk_version: body.sdk_version ?? null,
        properties: (body.properties ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await recordFirstTelemetry(prisma, projectId);
    await addIngestUnits(prisma, projectId, 1);
    void maybeNotifyQuotaAlerts(prisma, projectId).catch(() => {});
    return reply.status(204).send();
  });

  app.post("/session", async (request, reply) => {
    const projectId = requireIngestProjectId(request);
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;
    const app = body.app;
    if (!assertIngestAppAllowed(request, app, reply)) return;
    const piiSettings = await loadProjectPiiScrubSettings(prisma, projectId);
    const scrubSessionEmail = piiSettings.scrubSessionUserEmail;
    
    // Check if session exists to determine if this counts as new telemetry
    const existing = await findIngestSession(prisma, projectId, body.session_id, app);
    const isNewSession = !existing;
    
    // Closing a session only sets `ended_at` — no new telemetry; must not be blocked by quota.
    if (existing && body.ended_at) {
      await prisma.session.update({
        where: { id: existing.id },
        data: {
          ended_at: new Date(body.ended_at),
          ...(existing.app !== app ? { app } : {}),
          ...sessionContextPatch(body, scrubSessionEmail),
        },
      });
      return reply.status(204).send();
    }
    
    // For new sessions, check quota before proceeding
    if (isNewSession) {
      const planOk = await assertIngestPlanOrReply(prisma, projectId, 1, [app]);
      if (!planOk.ok) return reply.status(planOk.status).send(planOk.body);
    }
    
    // Use native INSERT ... ON CONFLICT for atomic upsert (Prisma's upsert does SELECT-then-INSERT)
    const scrubbedEmail = scrubIngestSessionUserEmail(
      body.user_email ?? null,
      scrubSessionEmail
    );
    const startedAt = body.started_at ? new Date(body.started_at) : new Date();
    const endedAt = body.ended_at ? new Date(body.ended_at) : null;
    
    // Identity timestamp: use provided identity_updated_at, or fall back to started_at if identity fields are present
    const hasIdentity = body.user_id !== undefined || body.user_email !== undefined;
    const identityUpdatedAt = body.identity_updated_at 
      ? new Date(body.identity_updated_at)
      : (hasIdentity ? startedAt : null);
    
    await prisma.$executeRaw`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, environment, release,
        user_id, user_email, anonymous_id, country, device_browser, device_os,
        sdk_version, started_at, ended_at, identity_updated_at
      ) VALUES (
        gen_random_uuid(),
        ${projectId},
        ${body.session_id},
        ${app},
        ${body.platform ?? null},
        ${normalizeIngestEnvironment(body.environment)},
        ${body.release ?? null},
        ${body.user_id ?? null},
        ${scrubbedEmail === undefined ? null : scrubbedEmail},
        ${body.anonymous_id ?? null},
        ${body.country ?? null},
        ${body.device_browser ?? null},
        ${body.device_os ?? null},
        ${body.sdk_version ?? null},
        ${startedAt},
        ${endedAt},
        ${identityUpdatedAt}
      )
      ON CONFLICT (project_id, session_id, app) DO UPDATE SET
        user_id = CASE
          WHEN EXCLUDED.identity_updated_at IS NOT NULL 
            AND ("Session".identity_updated_at IS NULL OR EXCLUDED.identity_updated_at > "Session".identity_updated_at)
          THEN COALESCE(EXCLUDED.user_id, "Session".user_id)
          ELSE "Session".user_id
        END,
        user_email = CASE
          WHEN EXCLUDED.identity_updated_at IS NOT NULL 
            AND ("Session".identity_updated_at IS NULL OR EXCLUDED.identity_updated_at > "Session".identity_updated_at)
          THEN COALESCE(EXCLUDED.user_email, "Session".user_email)
          ELSE "Session".user_email
        END,
        identity_updated_at = CASE
          WHEN EXCLUDED.identity_updated_at IS NOT NULL 
            AND ("Session".identity_updated_at IS NULL OR EXCLUDED.identity_updated_at > "Session".identity_updated_at)
          THEN EXCLUDED.identity_updated_at
          ELSE "Session".identity_updated_at
        END,
        anonymous_id = COALESCE(EXCLUDED.anonymous_id, "Session".anonymous_id),
        country = COALESCE(EXCLUDED.country, "Session".country),
        device_browser = COALESCE(EXCLUDED.device_browser, "Session".device_browser),
        device_os = COALESCE(EXCLUDED.device_os, "Session".device_os),
        sdk_version = COALESCE(EXCLUDED.sdk_version, "Session".sdk_version),
        platform = COALESCE(EXCLUDED.platform, "Session".platform),
        environment = COALESCE(EXCLUDED.environment, "Session".environment),
        release = COALESCE(EXCLUDED.release, "Session".release),
        ended_at = GREATEST("Session".ended_at, EXCLUDED.ended_at)
    `;
    
    if (isNewSession) {
      await recordFirstTelemetry(prisma, projectId);
      await addIngestUnits(prisma, projectId, 1);
    }
    void maybeNotifyQuotaAlerts(prisma, projectId).catch(() => {});
    return reply.status(204).send();
  });

  app.post("/batch", async (request, reply) => {
    const projectId = requireIngestProjectId(request);
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const n = parsed.data.events.length;
    for (const ev of parsed.data.events) {
      if (!assertIngestAppAllowed(request, ev.app, reply)) return;
    }
    const batchApps = parsed.data.events.map((e) => e.app);
    const planOk = await assertIngestPlanOrReply(prisma, projectId, n, batchApps);
    if (!planOk.ok) return reply.status(planOk.status).send(planOk.body);
    const denyKeys = await loadProjectPiiDenyKeys(prisma, projectId);
    for (const raw of parsed.data.events) {
      const body = scrubIngestEventFields(raw, process.env, { denyKeys });
      await prisma.event.create({
        data: {
          project_id: projectId,
          app: body.app,
          platform: body.platform ?? null,
          environment: normalizeIngestEnvironment(body.environment),
          release: body.release ?? null,
          name: body.name,
          user_id: body.user_id ?? null,
          session_id: body.session_id ?? null,
          anonymous_id: body.anonymous_id ?? null,
          sdk_version: body.sdk_version ?? null,
          properties: (body.properties ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }
    if (n > 0) await recordFirstTelemetry(prisma, projectId);
    await addIngestUnits(prisma, projectId, n);
    void maybeNotifyQuotaAlerts(prisma, projectId).catch(() => {});
    return reply.status(204).send();
  });

  app.post("/error", async (request, reply) => {
    const projectId = requireIngestProjectId(request);
    const parsed = errorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const denyKeys = await loadProjectPiiDenyKeys(prisma, projectId);
    const body = scrubIngestErrorFields(parsed.data, process.env, { denyKeys });
    const app = body.app;
    const release = normalizeMapReleaseLabel(body.release);
    if (!assertIngestAppAllowed(request, app, reply)) return;
    const planOk = await assertIngestPlanOrReply(prisma, projectId, 1, [app]);
    if (!planOk.ok) return reply.status(planOk.status).send(planOk.body);
    const fingerprint = computeFingerprint(body.message, body.stack);
    const platform = body.platform ?? null;
    const environment = normalizeIngestEnvironment(body.environment);
    const { group: errorGroup, isNew } = await findOrCreateErrorGroup(prisma, {
      projectId,
      fingerprint,
      message: body.message,
      top_stack: body.stack?.split("\n")[0]?.trim() ?? null,
      app,
      environment,
      release,
      platform,
    });
    await prisma.errorOccurrence.create({
      data: {
        error_group_id: errorGroup.id,
        stack: body.stack ?? null,
        release,
        platform,
        environment,
        context: (body.context ?? undefined) as Prisma.InputJsonValue | undefined,
        session_id: body.session_id ?? null,
        user_id: body.user_id ?? null,
        anonymous_id: body.anonymous_id ?? null,
        sdk_version: body.sdk_version ?? null,
      },
    });
    await recordFirstTelemetry(prisma, projectId);
    await addIngestUnits(prisma, projectId, 1);
    if (isNew) {
      void notifyNewErrorGroupEmail(prisma, projectId, errorGroup);
    }
    void maybeNotifyErrorSpike(prisma, projectId);
    void maybeEvaluateAlertRules(prisma, projectId);
    void maybeNotifyQuotaAlerts(prisma, projectId).catch(() => {});
    return reply.status(204).send();
  });
}
