import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { getSessionTokenFromRequest, getSessionUser } from "../lib/auth-session.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { hashPasswordResetToken } from "../lib/password-reset-token.js";
import { sendTransactionalEmail } from "../lib/email.js";
import { dashboardOriginOrNull } from "../lib/dashboard-origin.js";
import { subscribeMarketingEmail, REGISTRATION_CONSENT_LABEL } from "../lib/marketing-subscriber.js";
import { MarketingSubscriberSource } from "@prisma/client";
import { createUserSession } from "../lib/user-session.js";
import {
  MAX_AVATAR_BYTES,
  validateAvatarUpload,
} from "../lib/avatar-upload.js";
import { canViewUserAvatar } from "../lib/avatar-access.js";
import { publicUserAvatarFields } from "../lib/user-avatar.js";
import {
  avatarObjectKey,
  deleteAvatarObject,
  getAvatarObject,
  isAvatarStorageConfigured,
  putAvatarObject,
} from "../lib/avatar-storage.js";
import { AUDIT_ACTIONS, recordUserAuditEvents } from "../lib/audit-log.js";

const RESET_TOKEN_HOURS = 1;
const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isStrongPassword(p: string): boolean {
  return p.length >= 8 && p.length <= 256;
}

function mapAuthUser(user: {
  id: string;
  email: string;
  display_name: string | null;
  avatar_key?: string | null;
  avatar_updated_at?: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    ...publicUserAvatarFields({
      id: user.id,
      avatar_key: user.avatar_key ?? null,
      avatar_updated_at: user.avatar_updated_at ?? null,
    }),
  };
}

const AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export async function authRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  for (const contentType of AVATAR_CONTENT_TYPES) {
    app.addContentTypeParser(
      contentType,
      { parseAs: "buffer" },
      (_req, body, done) => {
        done(null, body);
      }
    );
  }

  app.post("/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      password?: string;
      displayName?: string;
      inviteToken?: string;
      marketingOptIn?: boolean;
      rewardfulReferralId?: string;
      viaToken?: string;
    };
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim() !== ""
        ? body.displayName.trim().slice(0, 120)
        : null;
    const inviteToken =
      typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
    const marketingOptIn = body.marketingOptIn !== false;
    const rewardfulReferralId =
      typeof body.rewardfulReferralId === "string" ? body.rewardfulReferralId.trim() : "";
    const viaToken =
      typeof body.viaToken === "string" ? body.viaToken.trim() : "";

    if (!email.includes("@")) {
      return reply.status(400).send({ error: "Invalid email" });
    }
    if (!isStrongPassword(password)) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }

    if (inviteToken) {
      const inviteOutcome = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT 1 FROM "OrganizationInvite" WHERE token = ${inviteToken} FOR UPDATE`
        );
        const invite = await tx.organizationInvite.findUnique({
          where: { token: inviteToken },
          include: { organization: { select: { deleted_at: true } } },
        });
        if (!invite) {
          return { kind: "invalid_invite" as const };
        }
        if (invite.organization.deleted_at != null) {
          return { kind: "invalid_invite" as const };
        }
        if (invite.expires_at.getTime() <= Date.now()) {
          return { kind: "expired" as const };
        }
        if (normalizeEmail(invite.email) !== email) {
          return { kind: "email_mismatch" as const };
        }
        const existingInvitee = await tx.user.findUnique({ where: { email } });
        if (existingInvitee) {
          return { kind: "email_taken" as const };
        }
        const passwordHash = hashPassword(password);
          try {
            const u = await tx.user.create({
              data: {
                email,
                password_hash: passwordHash,
                display_name: displayName,
                memberships: {
                  create: {
                    organization_id: invite.organization_id,
                    role: invite.role,
                  },
                },
              },
              select: {
                id: true,
                email: true,
                display_name: true,
                memberships: {
                  where: { organization_id: invite.organization_id },
                  select: { id: true },
                  take: 1,
                },
              },
            });
            await tx.organizationInvite.delete({ where: { id: invite.id } });
            const membershipId = u.memberships[0]?.id;
            if (!membershipId) {
              throw new Error("Invite signup did not create organization membership");
            }
            return {
              kind: "ok" as const,
              user: { id: u.id, email: u.email, display_name: u.display_name },
              organizationId: invite.organization_id,
              membershipId,
              role: invite.role,
            };
        } catch (e: unknown) {
          if (
            typeof e === "object" &&
            e !== null &&
            "code" in e &&
            (e as { code: string }).code === "P2002"
          ) {
            return { kind: "email_taken" as const };
          }
          throw e;
        }
      });
      if (inviteOutcome.kind === "invalid_invite" || inviteOutcome.kind === "expired") {
        return reply.status(400).send({ error: "Invalid or expired invite" });
      }
      if (inviteOutcome.kind === "email_mismatch") {
        return reply.status(400).send({ error: "Email must match the invite" });
      }
      if (inviteOutcome.kind === "email_taken") {
        return reply.status(409).send({ error: "Email already registered" });
      }
      const user = inviteOutcome.user;

      const { notifyTeamMemberJoinedEmail } = await import(
        "../lib/notification-email-dispatch.js"
      );
      void notifyTeamMemberJoinedEmail(prisma, inviteOutcome.organizationId, {
        membershipId: inviteOutcome.membershipId,
        email: user.email,
        displayName: user.display_name,
        role: inviteOutcome.role,
      });

      const { sessionId, expiresAt } = await createUserSession(user.id, request);

      if (marketingOptIn) {
        await subscribeMarketingEmail(prisma, {
          email: user.email,
          source: MarketingSubscriberSource.registration,
          consentLabel: REGISTRATION_CONSENT_LABEL,
          consentMetadata: {
            ip: request.ip,
            userAgent:
              typeof request.headers["user-agent"] === "string"
                ? request.headers["user-agent"].slice(0, 512)
                : undefined,
          },
        });
      }

      return reply.status(201).send({
        sessionId,
        expiresAt: expiresAt.toISOString(),
        organizationId: inviteOutcome.organizationId,
        user: mapAuthUser(user),
      });
    }

    const userCount = await prisma.user.count();
    const allowReg =
      process.env.TELEMETRY_ALLOW_REGISTRATION === "true" || userCount === 0;
    if (!allowReg) {
      return reply.status(403).send({ error: "Registration is disabled" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: "Email already registered" });
    }

    /** Self-serve signup: no organization until the user creates one or accepts an invite. */
    const user = await prisma.user.create({
      data: {
        email,
        password_hash: hashPassword(password),
        display_name: displayName,
      },
      select: { id: true, email: true, display_name: true },
    });

    // Capture affiliate referral at registration (if applicable)
    if (rewardfulReferralId || viaToken) {
      const { captureUserReferral } = await import("../lib/user-referral-capture.js");
      const captureResult = await captureUserReferral(
        prisma,
        {
          userId: user.id,
          userEmail: user.email,
          rewardfulReferralId: rewardfulReferralId || undefined,
          viaToken: viaToken || undefined,
        },
        request.log
      );
      
      if (captureResult.kind === "rejected_self_referral") {
        request.log.warn(
          { userId: user.id, reason: captureResult.reason },
          "Self-referral rejected at registration"
        );
      } else if (captureResult.kind === "captured") {
        request.log.info(
          { userId: user.id, userReferralId: captureResult.userReferralId },
          "User referral captured at registration"
        );
      }
    }

    const { sessionId, expiresAt } = await createUserSession(user.id, request);

    if (marketingOptIn) {
      await subscribeMarketingEmail(prisma, {
        email: user.email,
        source: MarketingSubscriberSource.registration,
        consentLabel: REGISTRATION_CONSENT_LABEL,
        consentMetadata: {
          ip: request.ip,
          userAgent:
            typeof request.headers["user-agent"] === "string"
              ? request.headers["user-agent"].slice(0, 512)
              : undefined,
        },
      });
    }

    return reply.status(201).send({
      sessionId,
      expiresAt: expiresAt.toISOString(),
      organizationId: null,
      user: mapAuthUser(user),
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return reply.status(400).send({ error: "email and password required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const { sessionId, expiresAt } = await createUserSession(user.id, request);

    await recordUserAuditEvents(prisma, user.id, AUDIT_ACTIONS.AUTH_LOGIN, user.email);

    const firstMembership = await prisma.organizationMembership.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: "asc" },
      select: { organization_id: true },
    });

    return reply.send({
      sessionId,
      expiresAt: expiresAt.toISOString(),
      organizationId: firstMembership?.organization_id ?? null,
      user: mapAuthUser(user),
    });
  });

  app.post("/auth/forgot-password", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string };
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const generic = { ok: true as const, message: "If that email exists, a reset link was sent." };

    if (!email.includes("@")) {
      return reply.status(400).send({ error: "Invalid email" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.send(generic);
    }

    const base = dashboardOriginOrNull();
    if (!base) {
      request.log.error(
        "TELEMETRY_DASHBOARD_ORIGIN is not configured; skipping password reset email"
      );
      return reply.send(generic);
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
    await prisma.passwordResetToken.deleteMany({ where: { user_id: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token: hashPasswordResetToken(token),
        expires_at: expiresAt,
      },
    });

    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;

    await sendTransactionalEmail({
      to: email,
      subject: "Reset your Telemetry Tracker password",
      html: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in ${RESET_TOKEN_HOURS} hour(s).</p>`,
    });

    if (process.env.NODE_ENV !== "production") {
      return reply.send({ ...generic, resetUrl, resetToken: token });
    }
    return reply.send(generic);
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const body = (request.body ?? {}) as { token?: string; password?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!token || token.length < 32) {
      return reply.status(400).send({ error: "Invalid or missing token" });
    }
    if (!isStrongPassword(password)) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }

    const row = await prisma.passwordResetToken.findUnique({
      where: { token: hashPasswordResetToken(token) },
    });
    if (!row || row.expires_at.getTime() <= Date.now()) {
      return reply.status(400).send({ error: "Invalid or expired reset link" });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.user_id },
        data: { password_hash: hashPassword(password) },
      }),
      prisma.passwordResetToken.delete({ where: { id: row.id } }),
      prisma.userSession.deleteMany({ where: { user_id: row.user_id } }),
    ]);

    return reply.send({ ok: true });
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = getSessionTokenFromRequest(request);
    if (token) {
      await prisma.userSession.deleteMany({ where: { id: token } });
    }
    return reply.status(204).send();
  });

  app.get("/auth/me", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        display_name: true,
        avatar_key: true,
        avatar_updated_at: true,
        memberships: {
          select: {
            role: true,
            organization_id: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return reply.send({
      user: mapAuthUser(user),
      memberships: user.memberships.map((m) => ({
        organizationId: m.organization_id,
        organizationName: m.organization.name,
        role: m.role,
      })),
    });
  });

  app.patch("/auth/me", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = (request.body ?? {}) as { displayName?: string };
    if ("displayName" in body && typeof body.displayName !== "string") {
      return reply.status(400).send({ error: "displayName must be a string" });
    }

    const existing = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true },
    });
    if (!existing) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const data: { display_name?: string | null } = {};
    if ("displayName" in body) {
      const trimmed = body.displayName!.trim();
      data.display_name = trimmed !== "" ? trimmed.slice(0, 120) : null;
    }

    const user = await prisma.user.update({
      where: { id: session.userId },
      data,
      select: {
        id: true,
        email: true,
        display_name: true,
        avatar_key: true,
        avatar_updated_at: true,
      },
    });

    if ("displayName" in body) {
      void recordUserAuditEvents(
        prisma,
        user.id,
        AUDIT_ACTIONS.PROFILE_UPDATE,
        user.display_name ?? user.email
      );
    }

    return reply.send({
      user: mapAuthUser(user),
    });
  });

  app.post(
    "/auth/me/avatar",
    { bodyLimit: MAX_AVATAR_BYTES + 16 * 1024 },
    async (request, reply) => {
      const session = await getSessionUser(request);
      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!isAvatarStorageConfigured() && process.env.NODE_ENV === "production") {
        return reply.status(503).send({ error: "Avatar storage is not configured" });
      }

      const raw = request.body;
      const buf = Buffer.isBuffer(raw)
        ? raw
        : typeof raw === "string"
          ? Buffer.from(raw, "binary")
          : Buffer.alloc(0);
      const contentType =
        typeof request.headers["content-type"] === "string"
          ? request.headers["content-type"]
          : undefined;
      const validated = validateAvatarUpload(buf, contentType);
      if (!validated.ok) {
        return reply.status(400).send({ error: validated.error });
      }

      const updatedAt = new Date();
      const objectKey = avatarObjectKey(session.userId, validated.contentType);

      const existing = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { avatar_key: true },
      });
      const previousKey =
        existing?.avatar_key && existing.avatar_key !== objectKey
          ? existing.avatar_key
          : null;

      await putAvatarObject(objectKey, buf, validated.contentType);

      const user = await prisma.user.update({
        where: { id: session.userId },
        data: {
          avatar_key: objectKey,
          avatar_content_type: validated.contentType,
          avatar_updated_at: updatedAt,
        },
        select: {
          id: true,
          email: true,
          display_name: true,
          avatar_key: true,
          avatar_updated_at: true,
        },
      });

      if (previousKey) {
        await deleteAvatarObject(previousKey);
      }

      void recordUserAuditEvents(
        prisma,
        user.id,
        AUDIT_ACTIONS.PROFILE_AVATAR_UPLOAD,
        user.email
      );

      return reply.send({ user: mapAuthUser(user) });
    }
  );

  app.delete("/auth/me/avatar", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!isAvatarStorageConfigured() && process.env.NODE_ENV === "production") {
      return reply.status(503).send({ error: "Avatar storage is not configured" });
    }

    const existing = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { avatar_key: true },
    });
    if (existing?.avatar_key) {
      await deleteAvatarObject(existing.avatar_key);
    }

    const user = await prisma.user.update({
      where: { id: session.userId },
      data: {
        avatar_key: null,
        avatar_content_type: null,
        avatar_updated_at: null,
      },
      select: {
        id: true,
        email: true,
        display_name: true,
        avatar_key: true,
        avatar_updated_at: true,
      },
    });

    if (existing?.avatar_key) {
      void recordUserAuditEvents(
        prisma,
        user.id,
        AUDIT_ACTIONS.PROFILE_AVATAR_REMOVE,
        user.email
      );
    }

    return reply.send({ user: mapAuthUser(user) });
  });

  app.get("/auth/avatars/:userId", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const userId = (request.params as { userId?: string }).userId?.trim() ?? "";
    if (!USER_ID_RE.test(userId)) {
      return reply.status(400).send({ error: "Invalid user id" });
    }

    const allowed = await canViewUserAvatar(prisma, session.userId, userId);
    if (!allowed) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    if (!isAvatarStorageConfigured() && process.env.NODE_ENV === "production") {
      return reply.status(503).send({ error: "Avatar storage is not configured" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatar_key: true,
        avatar_content_type: true,
        avatar_updated_at: true,
      },
    });
    if (!user?.avatar_key || !user.avatar_content_type || !user.avatar_updated_at) {
      return reply.status(404).send({ error: "Avatar not found" });
    }

    const version = (request.query as { v?: string }).v;
    const expectedVersion = String(user.avatar_updated_at.getTime());
    const cacheControl =
      version && version !== expectedVersion
        ? "private, no-cache"
        : "private, max-age=3600";

    const object = await getAvatarObject(user.avatar_key);
    if (!object) {
      return reply.status(404).send({ error: "Avatar not found" });
    }

    return reply
      .header("Content-Type", user.avatar_content_type)
      .header("Cache-Control", cacheControl)
      .send(object.body);
  });

  app.get("/auth/sessions", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const currentToken = getSessionTokenFromRequest(request);
    const now = new Date();
    const rows = await prisma.userSession.findMany({
      where: { user_id: session.userId, expires_at: { gt: now } },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        created_at: true,
        expires_at: true,
        device_browser: true,
        device_os: true,
      },
    });
    return reply.send({
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        deviceBrowser: row.device_browser,
        deviceOs: row.device_os,
        current: row.id === currentToken,
      })),
    });
  });

  app.delete("/auth/sessions/others", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const currentToken = getSessionTokenFromRequest(request);
    if (!currentToken) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const result = await prisma.userSession.deleteMany({
      where: {
        user_id: session.userId,
        id: { not: currentToken },
      },
    });
    void recordUserAuditEvents(
      prisma,
      session.userId,
      AUDIT_ACTIONS.AUTH_SESSIONS_REVOKE_OTHERS,
      `${result.count} session${result.count === 1 ? "" : "s"}`
    );
    return reply.send({ revoked: result.count });
  });

  app.delete("/auth/sessions/:sessionId", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const currentToken = getSessionTokenFromRequest(request);
    const sessionId = (request.params as { sessionId?: string }).sessionId?.trim() ?? "";
    if (!sessionId) {
      return reply.status(400).send({ error: "sessionId required" });
    }
    if (sessionId === currentToken) {
      return reply.status(400).send({ error: "Cannot revoke the current session" });
    }
    const row = await prisma.userSession.findFirst({
      where: { id: sessionId, user_id: session.userId },
      select: { id: true },
    });
    if (!row) {
      return reply.status(404).send({ error: "Session not found" });
    }
    await prisma.userSession.delete({ where: { id: row.id } });
    void recordUserAuditEvents(
      prisma,
      session.userId,
      AUDIT_ACTIONS.AUTH_SESSION_REVOKE,
      sessionId.slice(0, 8)
    );
    return reply.status(204).send();
  });

  app.post("/auth/change-password", async (request, reply) => {
    const session = await getSessionUser(request);
    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const currentToken = getSessionTokenFromRequest(request);
    const body = (request.body ?? {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: "currentPassword and newPassword required" });
    }
    if (!isStrongPassword(newPassword)) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }
    if (currentPassword === newPassword) {
      return reply.status(400).send({ error: "New password must differ from current password" });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, password_hash: true },
    });
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      return reply.status(401).send({ error: "Current password is incorrect" });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password_hash: hashPassword(newPassword) },
      }),
      prisma.passwordResetToken.deleteMany({ where: { user_id: user.id } }),
      ...(currentToken
        ? [
            prisma.userSession.deleteMany({
              where: { user_id: user.id, id: { not: currentToken } },
            }),
          ]
        : [prisma.userSession.deleteMany({ where: { user_id: user.id } })]),
    ]);

    const actor = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    if (actor) {
      void recordUserAuditEvents(
        prisma,
        user.id,
        AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
        actor.email
      );
    }

    return reply.send({ ok: true });
  });
}
