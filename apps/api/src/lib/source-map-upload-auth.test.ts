import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  assertSourceMapAppAllowed,
  resolveSourceMapUploadAuth,
} from "./source-map-upload-auth.js";

vi.mock("./api-key-auth.js", () => ({
  verifyIngestApiKey: vi.fn(),
}));

vi.mock("./auth-session.js", () => ({
  getSessionUser: vi.fn(),
  requireSessionUser: vi.fn(),
}));

vi.mock("./read-project-request.js", () => ({
  resolveReadProjectIdWithSession: vi.fn(),
}));

vi.mock("./org-permissions.js", () => ({
  canCreateApiKey: vi.fn(),
  getMembershipRoleForProject: vi.fn(),
}));

import { verifyIngestApiKey } from "./api-key-auth.js";
import { getSessionUser, requireSessionUser } from "./auth-session.js";
import { resolveReadProjectIdWithSession } from "./read-project-request.js";
import { canCreateApiKey, getMembershipRoleForProject } from "./org-permissions.js";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000099";

function mockReply() {
  const reply = {
    status: vi.fn(function (this: typeof reply) {
      return this;
    }),
    send: vi.fn(function (this: typeof reply) {
      return this;
    }),
  };
  return reply;
}

function mockRequest(headers: Record<string, string> = {}) {
  return { headers } as never;
}

describe("resolveSourceMapUploadAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("accepts session auth when user has EDITOR+ on the project", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", email: "a@b.c" });
    vi.mocked(requireSessionUser).mockResolvedValue({ userId: "u1", email: "a@b.c" });
    vi.mocked(resolveReadProjectIdWithSession).mockResolvedValue(PROJECT_ID);
    vi.mocked(getMembershipRoleForProject).mockResolvedValue("EDITOR");
    vi.mocked(canCreateApiKey).mockReturnValue(true);

    const reply = mockReply();
    const result = await resolveSourceMapUploadAuth({} as never, mockRequest(), reply);

    expect(result).toEqual({ projectId: PROJECT_ID, apiKeyAllowedApp: null });
    expect(verifyIngestApiKey).not.toHaveBeenCalled();
  });

  it("rejects session auth when user lacks EDITOR+", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", email: "a@b.c" });
    vi.mocked(requireSessionUser).mockResolvedValue({ userId: "u1", email: "a@b.c" });
    vi.mocked(resolveReadProjectIdWithSession).mockResolvedValue(PROJECT_ID);
    vi.mocked(getMembershipRoleForProject).mockResolvedValue("VIEWER");
    vi.mocked(canCreateApiKey).mockReturnValue(false);

    const reply = mockReply();
    const result = await resolveSourceMapUploadAuth({} as never, mockRequest(), reply);

    expect(result).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("accepts API key auth when X-Project-Id matches the key project", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(verifyIngestApiKey).mockResolvedValue({
      id: "key-1",
      projectId: PROJECT_ID,
      organizationPlanTier: "FREE",
      allowedApp: null,
    });

    const reply = mockReply();
    const result = await resolveSourceMapUploadAuth(
      {} as never,
      mockRequest({ "x-project-id": PROJECT_ID, "x-api-key": "tt_live_abc_def" }),
      reply
    );

    expect(result).toEqual({ projectId: PROJECT_ID, apiKeyAllowedApp: null });
  });

  it("rejects API key when X-Project-Id is missing", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(verifyIngestApiKey).mockResolvedValue({
      id: "key-1",
      projectId: PROJECT_ID,
      organizationPlanTier: "FREE",
      allowedApp: null,
    });

    const reply = mockReply();
    const result = await resolveSourceMapUploadAuth(
      {} as never,
      mockRequest({ "x-api-key": "tt_live_abc_def" }),
      reply
    );

    expect(result).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("rejects API key when X-Project-Id does not match", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(verifyIngestApiKey).mockResolvedValue({
      id: "key-1",
      projectId: PROJECT_ID,
      organizationPlanTier: "FREE",
      allowedApp: null,
    });

    const reply = mockReply();
    const result = await resolveSourceMapUploadAuth(
      {} as never,
      mockRequest({
        "x-project-id": "b0000000-0000-4000-8000-000000000001",
        "x-api-key": "tt_live_abc_def",
      }),
      reply
    );

    expect(result).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("returns 401 when no session and no valid API key", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(verifyIngestApiKey).mockResolvedValue(null);

    const reply = mockReply();
    const result = await resolveSourceMapUploadAuth({} as never, mockRequest(), reply);

    expect(result).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(401);
  });
});

describe("assertSourceMapAppAllowed", () => {
  it("allows any app when key is not restricted", () => {
    const reply = mockReply();
    expect(
      assertSourceMapAppAllowed({ projectId: PROJECT_ID, apiKeyAllowedApp: null }, "web", reply)
    ).toBe(true);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("rejects mismatched app labels for restricted keys", () => {
    const reply = mockReply();
    expect(
      assertSourceMapAppAllowed(
        { projectId: PROJECT_ID, apiKeyAllowedApp: "mobile" },
        "web",
        reply
      )
    ).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("accepts matching app labels (trimmed)", () => {
    const reply = mockReply();
    expect(
      assertSourceMapAppAllowed(
        { projectId: PROJECT_ID, apiKeyAllowedApp: " web " },
        "web",
        reply
      )
    ).toBe(true);
  });
});
