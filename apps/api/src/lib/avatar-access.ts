import type { PrismaClient } from "@prisma/client";

export async function canViewUserAvatar(
  prisma: PrismaClient,
  viewerUserId: string,
  targetUserId: string
): Promise<boolean> {
  if (viewerUserId === targetUserId) return true;
  const shared = await prisma.organizationMembership.findFirst({
    where: {
      user_id: viewerUserId,
      organization: {
        deleted_at: null,
        memberships: { some: { user_id: targetUserId } },
      },
    },
    select: { id: true },
  });
  return shared != null;
}
