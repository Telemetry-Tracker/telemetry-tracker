import test from "node:test";
import assert from "node:assert/strict";

import { resolveReadProjectId } from "./read-project-request.js";
import { prisma } from "./db.js";

type HeaderValue = string | string[] | undefined;
type RequestLike = { headers: Record<string, HeaderValue> };
type ReplyLike = {
  statusCode?: number;
  body?: unknown;
  status: (code: number) => ReplyLike;
  send: (payload: unknown) => Promise<void>;
};

const DEFAULT_PROJECT_ID = "a0000000-0000-4000-8000-000000000002";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";

function req(headers: Record<string, HeaderValue>): RequestLike {
  return { headers };
}

function reply(): ReplyLike {
  return {
    statusCode: undefined,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    async send(payload: unknown) {
      this.body = payload;
    },
  };
}

async function withDb(fn: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "UserSession",
      "OrganizationMembership",
      "User",
      "Project",
      "Organization"
    RESTART IDENTITY CASCADE
  `);
  try {
    await fn();
  } finally {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "UserSession",
        "OrganizationMembership",
        "User",
        "Project",
        "Organization"
      RESTART IDENTITY CASCADE
    `);
  }
}

async function seedBase() {
  await prisma.organization.createMany({
    data: [
      { id: MEMBER_ORG_ID, name: "member-org" },
      { id: OTHER_ORG_ID, name: "other-org" },
    ],
  });
  await prisma.project.createMany({
    data: [
      {
        id: DEFAULT_PROJECT_ID,
        organization_id: OTHER_ORG_ID,
        name: "default-project",
        slug: "default",
      },
      {
        id: MEMBER_PROJECT_ID,
        organization_id: MEMBER_ORG_ID,
        name: "member-project",
        slug: "member",
      },
      {
        id: OTHER_PROJECT_ID,
        organization_id: OTHER_ORG_ID,
        name: "other-project",
        slug: "other",
      },
    ],
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: "user@example.com",
      password_hash: "hash",
      memberships: {
        create: {
          organization_id: MEMBER_ORG_ID,
        },
      },
      sessions: {
        create: {
          id: SESSION_ID,
          expires_at: new Date(Date.now() + 10 * 60 * 1000),
        },
      },
    },
  });
}

test("resolveReadProjectId: unauthenticated request still falls back", async () => {
  await withDb(async () => {
    await seedBase();
    const r = reply();
    const projectId = await resolveReadProjectId(
      req({ "x-project-id": "not-a-uuid" }) as never,
      r as never
    );
    assert.equal(projectId, DEFAULT_PROJECT_ID);
    assert.equal(r.statusCode, undefined);
  });
});

test("resolveReadProjectId: authenticated member may read own org project", async () => {
  await withDb(async () => {
    await seedBase();
    const r = reply();
    const projectId = await resolveReadProjectId(
      req({
        authorization: `Bearer ${SESSION_ID}`,
        "x-project-id": MEMBER_PROJECT_ID,
      }) as never,
      r as never
    );
    assert.equal(projectId, MEMBER_PROJECT_ID);
    assert.equal(r.statusCode, undefined);
  });
});

test("resolveReadProjectId: authenticated user forbidden from fallback project outside org", async () => {
  await withDb(async () => {
    await seedBase();
    const r = reply();
    const projectId = await resolveReadProjectId(
      req({
        authorization: `Bearer ${SESSION_ID}`,
        "x-project-id": "not-a-uuid",
      }) as never,
      r as never
    );
    assert.equal(projectId, null);
    assert.equal(r.statusCode, 403);
    assert.deepEqual(r.body, { error: "Not a member of this project" });
  });
});

test("resolveReadProjectId: authenticated user forbidden from explicit foreign project", async () => {
  await withDb(async () => {
    await seedBase();
    const r = reply();
    const projectId = await resolveReadProjectId(
      req({
        authorization: `Bearer ${SESSION_ID}`,
        "x-project-id": OTHER_PROJECT_ID,
      }) as never,
      r as never
    );
    assert.equal(projectId, null);
    assert.equal(r.statusCode, 403);
    assert.deepEqual(r.body, { error: "Not a member of this project" });
  });
});
