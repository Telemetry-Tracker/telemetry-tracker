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

const RESET_TOKEN_HOURS = 1;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isStrongPassword(p: string): boolean {
  return p.length >= 8 && p.length <= 256;
}

export async function authRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  app.post("/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      password?: string;
      displayName?: string;
      inviteToken?: string;
      marketingOptIn?: boolean;
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
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
        },
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
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
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

    const firstMembership = await prisma.organizationMembership.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: "asc" },
      select: { organization_id: true },
    });

    return reply.send({
      sessionId,
      expiresAt: expiresAt.toISOString(),
      organizationId: firstMembership?.organization_id ?? null,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
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
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
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
      select: { id: true, email: true, display_name: true },
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    });
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

    return reply.send({ ok: true });
  });
}
