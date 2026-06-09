import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  createMembershipSchema,
  createOrganizationSchema,
  updateMembershipSchema,
  updateOrganizationSchema,
  userSearchSchema,
} from '@gsplat/shared';
import { requireAdmin, type AuthRequest, isMasterRole } from '../../middleware/auth.js';
import {
  activeMemberships,
  canAccessOrganization,
  permissionsFromMembership,
} from './permissions.js';

const editorDefaults = {
  canCreateSplats: false,
  canUploadSplats: true,
  canEditSplats: true,
  canDeleteSplats: false,
  canPublishSplats: false,
  canEditMarkers: true,
};

function serializeOrganization(org: any, currentUserRole?: string) {
  const splats = org.splats ?? [];
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    description: org.description,
    websiteUrl: org.websiteUrl,
    isPublic: org.isPublic,
    memberCount: org._count?.memberships ?? org.memberships?.length ?? 0,
    splatCount: org._count?.splats ?? splats.length ?? 0,
    publishedSplatCount: typeof org.publishedSplatCount === 'number'
      ? org.publishedSplatCount
      : splats.filter((s: any) => s.status === 'PUBLISHED').length,
    currentUserRole,
    createdAt: org.createdAt?.toISOString?.() ?? org.createdAt,
  };
}

function serializeMembership(m: any) {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    organizationSlug: m.organization.slug,
    role: m.role,
    status: m.status,
    permissions: permissionsFromMembership(m),
    createdAt: m.createdAt.toISOString(),
  };
}

export async function adminOrganizationRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.addHook('onRequest', requireAdmin);

  app.get('/organizations', async (request) => {
    const auth = request as AuthRequest;
    if (isMasterRole(auth.user?.role)) {
      const orgs = await prisma.organization.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { memberships: true, splats: true } },
          splats: { select: { status: true } },
        },
      });
      return { items: orgs.map((org) => serializeOrganization(org, 'MASTER_ADMIN')) };
    }

    const memberships = await activeMemberships(prisma, auth.user!.id);
    return {
      items: memberships.map((m) => serializeOrganization({
        ...m.organization,
        memberships: [m],
        splats: [],
      }, m.role)),
    };
  });

  app.post('/organizations', async (request, reply) => {
    const auth = request as AuthRequest;
    const data = createOrganizationSchema.parse(request.body);
    const canCreate = isMasterRole(auth.user?.role) || (
      await prisma.organizationMembership.count({
        where: { userId: auth.user!.id, role: 'MANAGER', status: 'ACTIVE' },
      })
    ) > 0;

    if (!canCreate) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Manager access required to create organizations' },
      });
    }

    const existing = await prisma.organization.findUnique({ where: { slug: data.slug } });
    if (existing) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'Organization slug already exists' },
      });
    }

    const org = await prisma.organization.create({
      data: {
        slug: data.slug,
        name: data.name,
        description: data.description,
        websiteUrl: data.websiteUrl,
        isPublic: data.isPublic,
        createdByUserId: auth.user!.id,
      },
    });

    const managerUserId = data.managerUserId || auth.user!.id;
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: managerUserId } },
      update: { role: 'MANAGER', status: 'ACTIVE' },
      create: {
        organizationId: org.id,
        userId: managerUserId,
        role: 'MANAGER',
        status: 'ACTIVE',
        canCreateSplats: true,
        canUploadSplats: true,
        canEditSplats: true,
        canDeleteSplats: true,
        canPublishSplats: true,
        canEditMarkers: true,
        invitedByUserId: auth.user!.id,
      },
    });

    return { organization: serializeOrganization({ ...org, splats: [], memberships: [] }, 'MANAGER') };
  });

  app.get('/organizations/:id', async (request, reply) => {
    const auth = request as AuthRequest;
    const { id } = request.params as { id: string };
    if (!await canAccessOrganization(prisma, auth, id, 'view')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Organization access denied' } });
    }

    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { user: true, organization: true },
          orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
        },
        splats: { select: { status: true } },
        _count: { select: { memberships: true, splats: true } },
      },
    });
    if (!org) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Organization not found' } });
    }

    return {
      organization: serializeOrganization(org, isMasterRole(auth.user?.role) ? 'MASTER_ADMIN' : undefined),
      memberships: org.memberships.map(serializeMembership),
    };
  });

  app.patch('/organizations/:id', async (request, reply) => {
    const auth = request as AuthRequest;
    const { id } = request.params as { id: string };
    if (!await canAccessOrganization(prisma, auth, id, 'edit')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Manager access required' } });
    }

    const data = updateOrganizationSchema.parse(request.body);
    if (data.slug) {
      const existing = await prisma.organization.findUnique({ where: { slug: data.slug } });
      if (existing && existing.id !== id) {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Organization slug already exists' } });
      }
    }

    const organization = await prisma.organization.update({ where: { id }, data });
    return { organization: serializeOrganization({ ...organization, splats: [], memberships: [] }) };
  });

  app.get('/organizations/:id/members', async (request, reply) => {
    const auth = request as AuthRequest;
    const { id } = request.params as { id: string };
    if (!await canAccessOrganization(prisma, auth, id, 'members')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Manager access required' } });
    }

    const memberships = await prisma.organizationMembership.findMany({
      where: { organizationId: id },
      include: { user: true, organization: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    });
    return { items: memberships.map(serializeMembership) };
  });

  app.post('/organizations/:id/members', async (request, reply) => {
    const auth = request as AuthRequest;
    const { id } = request.params as { id: string };
    if (!await canAccessOrganization(prisma, auth, id, 'members')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Manager access required' } });
    }

    const data = createMembershipSchema.parse(request.body);
    if (data.role === 'MANAGER' && !isMasterRole(auth.user?.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only master admin can add managers' } });
    }

    const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Client account not found' } });
    }

    const permissions = data.role === 'MANAGER'
      ? {
        canCreateSplats: true,
        canUploadSplats: true,
        canEditSplats: true,
        canDeleteSplats: true,
        canPublishSplats: true,
        canEditMarkers: true,
      }
      : { ...editorDefaults, ...(data.permissions ?? {}) };

    const membership = await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: id, userId: user.id } },
      update: {
        role: data.role,
        status: 'ACTIVE',
        ...permissions,
      },
      create: {
        organizationId: id,
        userId: user.id,
        role: data.role,
        status: 'ACTIVE',
        ...permissions,
        invitedByUserId: auth.user!.id,
      },
      include: { user: true, organization: true },
    });

    return { membership: serializeMembership(membership) };
  });

  app.patch('/memberships/:id', async (request, reply) => {
    const auth = request as AuthRequest;
    const { id } = request.params as { id: string };
    const membership = await prisma.organizationMembership.findUnique({
      where: { id },
      include: { user: true, organization: true },
    });
    if (!membership) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Membership not found' } });
    }
    if (!await canAccessOrganization(prisma, auth, membership.organizationId, 'members')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Manager access required' } });
    }

    const data = updateMembershipSchema.parse(request.body);
    if ((data.role === 'MANAGER' || membership.role === 'MANAGER') && !isMasterRole(auth.user?.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only master admin can manage managers' } });
    }

    const updated = await prisma.organizationMembership.update({
      where: { id },
      data: {
        ...(data.role ? { role: data.role } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.permissions ? data.permissions : {}),
      },
      include: { user: true, organization: true },
    });

    return { membership: serializeMembership(updated) };
  });

  app.delete('/memberships/:id', async (request, reply) => {
    const auth = request as AuthRequest;
    const { id } = request.params as { id: string };
    const membership = await prisma.organizationMembership.findUnique({ where: { id } });
    if (!membership) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Membership not found' } });
    }
    if (!await canAccessOrganization(prisma, auth, membership.organizationId, 'members')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Manager access required' } });
    }
    if (membership.role === 'MANAGER' && !isMasterRole(auth.user?.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only master admin can remove managers' } });
    }

    await prisma.organizationMembership.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/users', async (request, reply) => {
    const auth = request as AuthRequest;
    const { q } = userSearchSchema.parse(request.query);
    if (!isMasterRole(auth.user?.role)) {
      const managerCount = await prisma.organizationMembership.count({
        where: { userId: auth.user!.id, role: 'MANAGER', status: 'ACTIVE' },
      });
      if (managerCount < 1) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Manager access required' } });
      }
    }

    const users = await prisma.user.findMany({
      where: q
        ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
        : {},
      include: {
        memberships: {
          include: { organization: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        memberships: u.memberships.map((m) => ({
          organizationId: m.organizationId,
          organizationName: m.organization.name,
          role: m.role,
          status: m.status,
        })),
        createdAt: u.createdAt.toISOString(),
      })),
    };
  });
}
