import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createSplatSchema, updateSplatSchema, pretransformSchema, pretransformUpdateSchema, defaultCameraSchema } from '@gsplat/shared';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { accessibleOrganizationIds, canAccessSplat, canCreateSplatInOrganization } from './permissions.js';

export async function adminSplatRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  // All admin routes require admin/editor role
  app.addHook('onRequest', requireAdmin);

  // GET /api/admin/splats
  app.get('/splats', async (request) => {
    const orgIds = await accessibleOrganizationIds(prisma, request as AuthRequest);
    const splats = await prisma.splat.findMany({
      where: orgIds === null ? {} : { organizationId: { in: orgIds } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { annotations: true, versions: true } },
        organization: { select: { id: true, slug: true, name: true, description: true } },
      },
    });

    return {
      items: splats.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        description: s.description,
        status: s.status,
        sourceFormat: s.sourceFormat,
        organizationId: s.organizationId,
        organization: s.organization ? {
          id: s.organization.id,
          slug: s.organization.slug,
          name: s.organization.name,
          description: s.organization.description,
        } : null,
        splatCount: s.splatCount,
        sizeBytes: s.sizeBytes ? Number(s.sizeBytes) : null,
        annotationCount: s._count.annotations,
        versionCount: s._count.versions,
        posterKey: s.posterKey,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        publishedAt: s.publishedAt?.toISOString() ?? null,
      })),
    };
  });

  // POST /api/admin/splats
  app.post('/splats', async (request, reply) => {
    const auth = request as AuthRequest;
    const data = createSplatSchema.parse(request.body);

    const existing = await prisma.splat.findUnique({ where: { slug: data.slug } });
    if (existing) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'A splat with this slug already exists' },
      });
    }

    if (!data.organizationId) {
      return reply.status(400).send({
        error: { code: 'ORG_REQUIRED', message: 'Select an organization before creating a splat' },
      });
    }

    const canCreate = await canCreateSplatInOrganization(prisma, auth, data.organizationId);
    if (!canCreate) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot create splats in this organization' },
      });
    }

    const splat = await prisma.splat.create({ data });

    return { splat };
  });

  // GET /api/admin/splats/:id
  app.get('/splats/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'view');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Splat access denied' },
      });
    }

    const splat = await prisma.splat.findUnique({
      where: { id },
      include: {
        annotations: true,
        versions: { orderBy: { version: 'desc' } },
        organization: { select: { id: true, slug: true, name: true, description: true } },
      },
    });

    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    return {
      splat: {
        ...splat,
        sizeBytes: splat.sizeBytes ? Number(splat.sizeBytes) : null,
      },
    };
  });

  // PATCH /api/admin/splats/:id
  app.patch('/splats/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateSplatSchema.parse(request.body);

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'edit');
    const splat = access.splat;
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit this splat' },
      });
    }

    if (data.slug && data.slug !== splat.slug) {
      const existing = await prisma.splat.findUnique({ where: { slug: data.slug } });
      if (existing) {
        return reply.status(409).send({
          error: { code: 'CONFLICT', message: 'Slug already in use' },
        });
      }
    }

    if (data.organizationId && data.organizationId !== splat.organizationId) {
      const canMove = await canCreateSplatInOrganization(prisma, request as AuthRequest, data.organizationId);
      if (!canMove) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'You cannot move this splat to that organization' },
        });
      }
    }

    const { defaultCameraJson, ...coreData } = data;
    const prismaData = {
      ...coreData,
      ...(defaultCameraJson !== undefined ? { defaultCameraJson: defaultCameraJson as any } : {}),
    };

    const updated = await prisma.splat.update({ where: { id }, data: prismaData });

    return {
      splat: {
        ...updated,
        sizeBytes: updated.sizeBytes ? Number(updated.sizeBytes) : null,
      },
    };
  });

  // DELETE /api/admin/splats/:id
  app.delete('/splats/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'delete');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot delete this splat' },
      });
    }

    await prisma.splat.delete({ where: { id } });

    return { ok: true };
  });

  // POST /api/admin/splats/:id/publish
  app.post('/splats/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'publish');
    const splat = access.splat;
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot publish this splat' },
      });
    }

    // Only allow publishing if there's a ready version
    const readyVersion = await prisma.splatVersion.findFirst({
      where: { splatId: id, processingStatus: 'READY' },
    });

    if (!readyVersion) {
      return reply.status(400).send({
        error: { code: 'NO_READY_VERSION', message: 'No ready version available. Process a version first.' },
      });
    }

    const published = await prisma.splat.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    return { splat: { ...published, sizeBytes: published.sizeBytes ? Number(published.sizeBytes) : null } };
  });

  // ── Pretransform endpoints ──

  // GET /api/admin/splats/:id/transform
  app.get('/splats/:id/transform', async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'edit');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit this splat' },
      });
    }
    const splat = await prisma.splat.findUnique({
      where: { id },
      select: { pretransformJson: true },
    });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    return { pretransform: splat.pretransformJson || null };
  });

  // PATCH /api/admin/splats/:id/transform
  app.patch('/splats/:id/transform', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = pretransformUpdateSchema.parse(request.body);

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'edit');
    const splat = access.splat;
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit this splat' },
      });
    }

    // Merge with existing pretransform if partial update
    const existing = (splat.pretransformJson || { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }) as Record<string, number[]>;
    const merged = {
      position: data.position || existing.position || [0, 0, 0],
      rotation: data.rotation || existing.rotation || [0, 0, 0],
      scale: data.scale || existing.scale || [1, 1, 1],
    };

    // Validate full shape
    pretransformSchema.parse(merged);

    const updated = await prisma.splat.update({
      where: { id },
      data: { pretransformJson: merged },
      select: { pretransformJson: true },
    });

    return { pretransform: updated.pretransformJson };
  });

  // ── Default Camera endpoints ──

  // PATCH /api/admin/splats/:id/camera
  app.patch('/splats/:id/camera', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = defaultCameraSchema.parse(request.body);

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'edit');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit this splat' },
      });
    }

    const updated = await prisma.splat.update({
      where: { id },
      data: { defaultCameraJson: data },
      select: { defaultCameraJson: true },
    });

    return { defaultCamera: updated.defaultCameraJson };
  });

  // DELETE /api/admin/splats/:id/camera
  app.delete('/splats/:id/camera', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'edit');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit this splat' },
      });
    }

    const updated = await prisma.splat.update({
      where: { id },
      data: { defaultCameraJson: Prisma.JsonNull },
      select: { defaultCameraJson: true },
    });

    return { defaultCamera: null };
  });

  // GET /api/admin/splats/:id/versions
  app.get('/splats/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'view');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Splat access denied' },
      });
    }

    const versions = await prisma.splatVersion.findMany({
      where: { splatId: id },
      orderBy: { version: 'desc' },
    });

    return {
      items: versions.map((v) => ({
        id: v.id,
        version: v.version,
        sourceKey: v.sourceKey,
        convertedKey: v.convertedKey,
        lodKey: v.lodKey,
        posterKey: v.posterKey,
        processingStatus: v.processingStatus,
        processingLog: v.processingLog,
        metrics: v.metricsJson,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
    };
  });

  // POST /api/admin/splats/:id/unpublish
  app.post('/splats/:id/unpublish', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'publish');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot unpublish this splat' },
      });
    }

    const unpublished = await prisma.splat.update({
      where: { id },
      data: { status: 'READY', publishedAt: null },
    });

    return { splat: { ...unpublished, sizeBytes: unpublished.sizeBytes ? Number(unpublished.sizeBytes) : null } };
  });
}
