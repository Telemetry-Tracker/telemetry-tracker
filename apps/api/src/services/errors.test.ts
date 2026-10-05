import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  errorGroup: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
};

import { findOrCreateErrorGroup } from "./errors.js";

describe("findOrCreateErrorGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores release on new groups", async () => {
    prisma.errorGroup.findUnique.mockResolvedValueOnce(null);
    prisma.errorGroup.create.mockResolvedValueOnce({
      id: "eg-1",
      message: "boom",
      app: "web",
      environment: "production",
    });

    await findOrCreateErrorGroup(prisma as never, {
      projectId: "p1",
      fingerprint: "fp",
      message: "boom",
      top_stack: "at foo",
      app: "web",
      environment: "production",
      release: "1.2.0",
    });

    expect(prisma.errorGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ release: "1.2.0" }),
      })
    );
  });

  it("updates release on existing groups when provided", async () => {
    prisma.errorGroup.findUnique.mockResolvedValueOnce({ id: "eg-1" });
    prisma.errorGroup.update.mockResolvedValueOnce({});

    await findOrCreateErrorGroup(prisma as never, {
      projectId: "p1",
      fingerprint: "fp",
      message: "boom",
      top_stack: "at foo",
      app: "web",
      release: "1.2.1",
    });

    expect(prisma.errorGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ release: "1.2.1" }),
      })
    );
  });

  it("returns isNew only for the first fingerprint (NEW_ERROR_GROUP fires once per group)", async () => {
    prisma.errorGroup.findUnique.mockResolvedValueOnce(null);
    prisma.errorGroup.create.mockResolvedValueOnce({
      id: "eg-1",
      message: "Profile query failed",
      app: "web",
      environment: "production",
    });

    const created = await findOrCreateErrorGroup(prisma as never, {
      projectId: "p1",
      fingerprint: "Profile query failed\nError: Profile query failed",
      message: "Profile query failed",
      top_stack: "Error: Profile query failed",
      app: "web",
      environment: "production",
    });
    expect(created.isNew).toBe(true);

    prisma.errorGroup.findUnique.mockResolvedValueOnce({
      id: "eg-1",
      message: "Profile query failed",
      app: "web",
      environment: "production",
    });
    prisma.errorGroup.update.mockResolvedValueOnce({});

    const repeat = await findOrCreateErrorGroup(prisma as never, {
      projectId: "p1",
      fingerprint: "Profile query failed\nError: Profile query failed",
      message: "Profile query failed",
      top_stack: "Error: Profile query failed",
      app: "web",
      environment: "production",
    });
    expect(repeat.isNew).toBe(false);
    expect(prisma.errorGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ occurrences: { increment: 1 } }),
      })
    );
  });

  it("on create race (P2002), re-fetches existing group and returns isNew false", async () => {
    prisma.errorGroup.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "eg-winner",
        message: "boom",
        app: "web",
        environment: "production",
      });
    prisma.errorGroup.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
    );
    prisma.errorGroup.update.mockResolvedValueOnce({});

    const result = await findOrCreateErrorGroup(prisma as never, {
      projectId: "p1",
      fingerprint: "fp",
      message: "boom",
      top_stack: "at foo",
      app: "web",
      environment: "production",
      release: "1.2.0",
    });

    expect(result).toEqual({
      group: {
        id: "eg-winner",
        message: "boom",
        app: "web",
        environment: "production",
      },
      isNew: false,
    });
    expect(prisma.errorGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "eg-winner" },
        data: expect.objectContaining({
          occurrences: { increment: 1 },
          release: "1.2.0",
        }),
      })
    );
  });

  it("re-throws non-P2002 create errors", async () => {
    prisma.errorGroup.findUnique.mockResolvedValueOnce(null);
    prisma.errorGroup.create.mockRejectedValueOnce(
      Object.assign(new Error("db down"), { code: "P1001" })
    );

    await expect(
      findOrCreateErrorGroup(prisma as never, {
        projectId: "p1",
        fingerprint: "fp",
        message: "boom",
        top_stack: "at foo",
        app: "web",
      })
    ).rejects.toMatchObject({ code: "P1001" });
    expect(prisma.errorGroup.update).not.toHaveBeenCalled();
  });
});
