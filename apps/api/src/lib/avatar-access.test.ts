import { describe, expect, it } from "vitest";
import { canViewUserAvatar } from "./avatar-access.js";

describe("canViewUserAvatar", () => {
  it("allows a user to view their own avatar", async () => {
    const prisma = {
      organizationMembership: {
        findFirst: async () => {
          throw new Error("should not query membership for self");
        },
      },
    };

    await expect(
      canViewUserAvatar(prisma as never, "user-a", "user-a")
    ).resolves.toBe(true);
  });

  it("allows access when viewer and target share an active organization", async () => {
    let capturedWhere: unknown;
    const prisma = {
      organizationMembership: {
        findFirst: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return { id: "membership-1" };
        },
      },
    };

    await expect(
      canViewUserAvatar(prisma as never, "viewer-id", "target-id")
    ).resolves.toBe(true);

    expect(capturedWhere).toEqual({
      user_id: "viewer-id",
      organization: {
        deleted_at: null,
        memberships: { some: { user_id: "target-id" } },
      },
    });
  });

  it("denies access when no shared active organization exists", async () => {
    const prisma = {
      organizationMembership: {
        findFirst: async () => null,
      },
    };

    await expect(
      canViewUserAvatar(prisma as never, "viewer-id", "target-id")
    ).resolves.toBe(false);
  });
});
