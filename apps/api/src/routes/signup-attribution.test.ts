import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authRoutes } from "./auth.js";
import { prisma } from "../lib/db.js";

vi.mock("../lib/db.js", () => ({ prisma: {
  user: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  organizationInvite: { findUnique: vi.fn(), delete: vi.fn() },
  $executeRaw: vi.fn(), $transaction: vi.fn(),
} }));
vi.mock("../lib/user-session.js", () => ({ createUserSession: vi.fn().mockResolvedValue({ sessionId: "session", expiresAt: new Date() }) }));
vi.mock("../lib/notification-email-dispatch.js", () => ({ notifyTeamMemberJoinedEmail: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.count).mockResolvedValue(0);
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "user", email: "new@example.org", display_name: null, memberships: [{ id: "membership" }] } as never);
  vi.mocked(prisma.organizationInvite.findUnique).mockResolvedValue({ id: "invite", email: "new@example.org", organization_id: "org", role: "MEMBER", expires_at: new Date(Date.now() + 60000), organization: { deleted_at: null } } as never);
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (callback as unknown as (tx: unknown) => Promise<unknown>)(prisma));
});
describe("registration attribution persistence", () => {
  for (const inviteToken of [undefined, "invite"]) {
    it(`persists sanitized values for ${inviteToken ? "invite" : "self-serve"} registration`, async () => {
      const app = Fastify();
      await app.register(authRoutes);
      try {
        const response = await app.inject({ method: "POST", url: "/auth/register", payload: {
          email: "new@example.org", password: "long-password", marketingOptIn: false, inviteToken,
          signupAttribution: { utm_source: " newsletter ", referrer_host: "https://search.example/path?private=secret" },
        } });
        expect(response.statusCode, response.body).toBe(201);
        expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ utm_source: "newsletter", referrer_host: "search.example", utm_campaign: null }) }));
      } finally { await app.close(); }
    });
  }
  it("allows malformed attribution without blocking signup", async () => {
    const app = Fastify();
    await app.register(authRoutes);
    try {
      const response = await app.inject({ method: "POST", url: "/auth/register", payload: {
        email: "new@example.org", password: "long-password", marketingOptIn: false,
        signupAttribution: { utm_source: [], referrer_host: "bad url" },
      } });
      expect(response.statusCode, response.body).toBe(201);
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ utm_source: null, referrer_host: null }) }));
    } finally { await app.close(); }
  });
  it("never updates an existing user's acquisition values", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "existing", utm_source: "original" } as never);
    const app = Fastify();
    await app.register(authRoutes);
    try {
      const response = await app.inject({ method: "POST", url: "/auth/register", payload: {
        email: "new@example.org", password: "long-password", signupAttribution: { utm_source: "later" },
      } });
      expect(response.statusCode).toBe(409);
      expect(prisma.user.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
