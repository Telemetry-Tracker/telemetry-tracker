import { OrgRole } from "@prisma/client";
import { prisma } from "./db.js";

/**
 * Org role for `userId` in the organization that owns `projectId` (one query: project + membership).
 */
export async function getMembershipRoleForProject(
  userId: string,
  projectId: string
): Promise<OrgRole | null> {
  const row = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: {
      organization: {
        select: {
          memberships: {
            where: { user_id: userId },
            select: { role: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!row) return null;
  return row.organization.memberships[0]?.role ?? null;
}

export async function getMembershipRoleForOrganization(
  userId: string,
  organizationId: string
): Promise<OrgRole | null> {
  const m = await prisma.organizationMembership.findFirst({
    where: { user_id: userId, organization_id: organizationId },
    select: { role: true },
  });
  return m?.role ?? null;
}

export function canResolveErrors(role: OrgRole | null): boolean {
  if (role === null) return false;
  return role === OrgRole.OWNER || role === OrgRole.EDITOR;
}

export function canCreateApiKey(role: OrgRole | null): boolean {
  if (role === null) return false;
  return role === OrgRole.OWNER || role === OrgRole.EDITOR;
}

/** Register / update ProjectApp rows (connect application flow). */
export function canRegisterProjectApp(role: OrgRole | null): boolean {
  return canCreateApiKey(role);
}

export function canRevokeApiKey(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canCreateProject(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canManageMembers(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canArchiveOrganization(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canArchiveProject(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}
