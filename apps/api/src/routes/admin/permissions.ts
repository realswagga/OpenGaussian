import type { PrismaClient, OrganizationMembership } from '@prisma/client';
import { isMasterRole, type AuthRequest } from '../../middleware/auth.js';

export type SplatAction = 'view' | 'create' | 'edit' | 'delete' | 'upload' | 'publish' | 'markers';
export type OrgAction = 'view' | 'edit' | 'members' | 'widget';

export function permissionsFromMembership(membership: OrganizationMembership) {
  const manager = membership.role === 'MANAGER';
  return {
    canCreateSplats: manager || membership.canCreateSplats,
    canUploadSplats: manager || membership.canUploadSplats,
    canEditSplats: manager || membership.canEditSplats,
    canDeleteSplats: manager || membership.canDeleteSplats,
    canPublishSplats: manager || membership.canPublishSplats,
    canEditMarkers: manager || membership.canEditMarkers,
  };
}

export function canEditorPerform(membership: OrganizationMembership, action: SplatAction): boolean {
  if (action === 'view') return true;
  if (membership.role === 'MANAGER') return true;
  const permissions = permissionsFromMembership(membership);
  switch (action) {
    case 'create':
      return permissions.canCreateSplats;
    case 'edit':
      return permissions.canEditSplats;
    case 'delete':
      return permissions.canDeleteSplats;
    case 'upload':
      return permissions.canUploadSplats;
    case 'publish':
      return permissions.canPublishSplats;
    case 'markers':
      return permissions.canEditMarkers;
    default:
      return false;
  }
}

export async function activeMemberships(prisma: PrismaClient, userId: string) {
  return prisma.organizationMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: {
      organization: {
        select: { id: true, slug: true, name: true, description: true, isPublic: true },
      },
    },
    orderBy: [{ role: 'asc' }, { updatedAt: 'desc' }],
  });
}

export async function accessibleOrganizationIds(prisma: PrismaClient, request: AuthRequest): Promise<string[] | null> {
  if (!request.user) return [];
  if (isMasterRole(request.user.role)) return null;
  const memberships = await activeMemberships(prisma, request.user.id);
  return memberships.map((m) => m.organizationId);
}

export async function canAccessOrganization(
  prisma: PrismaClient,
  request: AuthRequest,
  organizationId: string | null | undefined,
  action: OrgAction = 'view',
): Promise<boolean> {
  if (!request.user) return false;
  if (isMasterRole(request.user.role)) return true;
  if (!organizationId) return false;

  const membership = await prisma.organizationMembership.findFirst({
    where: { organizationId, userId: request.user.id, status: 'ACTIVE' },
  });
  if (!membership) return false;
  if (action === 'view') return true;
  return membership.role === 'MANAGER';
}

export async function canAccessSplat(
  prisma: PrismaClient,
  request: AuthRequest,
  splatId: string,
  action: SplatAction = 'view',
) {
  const splat = await prisma.splat.findUnique({
    where: { id: splatId },
    include: { organization: true },
  });
  if (!splat || !request.user) return { ok: false, splat: null };
  if (isMasterRole(request.user.role)) return { ok: true, splat };
  if (!splat.organizationId) return { ok: false, splat };

  const membership = await prisma.organizationMembership.findFirst({
    where: {
      organizationId: splat.organizationId,
      userId: request.user.id,
      status: 'ACTIVE',
    },
  });
  if (!membership) return { ok: false, splat };
  return { ok: canEditorPerform(membership, action), splat };
}

export async function canCreateSplatInOrganization(
  prisma: PrismaClient,
  request: AuthRequest,
  organizationId: string,
) {
  if (!request.user) return false;
  if (isMasterRole(request.user.role)) return true;
  const membership = await prisma.organizationMembership.findFirst({
    where: { organizationId, userId: request.user.id, status: 'ACTIVE' },
  });
  return membership ? canEditorPerform(membership, 'create') : false;
}
