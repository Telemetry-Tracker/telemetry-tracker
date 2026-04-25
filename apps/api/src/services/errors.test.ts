import { describe, expect, it, vi } from "vitest";
import { findOrCreateErrorGroup } from "./errors.js";
import type { PrismaClient } from "@prisma/client";

describe("findOrCreateErrorGroup", () => {
  it("uses an atomic upsert keyed by project and fingerprint", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "group-1" });
    const prisma = {
      errorGroup: { upsert },
    } as unknown as PrismaClient;

    await expect(
      findOrCreateErrorGroup(prisma, {
        projectId: "project-1",
        fingerprint: "message\nstack",
        message: "message",
        top_stack: "stack",
        app: "web",
        environment: "production",
      })
    ).resolves.toEqual({ id: "group-1" });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        project_id_fingerprint: {
          project_id: "project-1",
          fingerprint: "message\nstack",
        },
      },
      create: {
        project_id: "project-1",
        fingerprint: "message\nstack",
        message: "message",
        top_stack: "stack",
        app: "web",
        environment: "production",
        occurrences: 1,
      },
      update: {
        occurrences: { increment: 1 },
        last_seen: expect.any(Date),
        environment: "production",
      },
    });
  });
});
