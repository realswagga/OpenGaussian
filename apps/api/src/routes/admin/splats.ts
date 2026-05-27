import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createSplatSchema, updateSplatSchema, pretransformSchema, pretransformUpdateSchema, defaultCameraSchema } from '@gsplat/shared';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';

export async function adminSplatRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  // All admin routes require admin/editor role
  app.addHook('onRequest', requireAdmin);

  // GET /api/admin/splats
  app.get('/splats', async () => {
    const splats = await prisma.splat.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { annotations: true, versions: true } },
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
    const data = createSplatSchema.parse(request.body);

    const existing = await prisma.splat.findUnique({ where: { slug: data.slug } });
    if (existing) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'A splat with this slug already exists' },
      });
    }

    const splat = await prisma.splat.create({ data });

    return { splat };
  });

  // GET /api/admin/splats/:id
  app.get('/splats/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const splat = await prisma.splat.findUnique({
      where: { id },
      include: {
        annotations: true,
        versions: { orderBy: { version: 'desc' } },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    await prisma.splat.delete({ where: { id } });

    return { ok: true };
  });

  // POST /api/admin/splats/:id/publish
  app.post('/splats/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
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

    const splat = await prisma.splat.findUnique({ where: { id } });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    const unpublished = await prisma.splat.update({
      where: { id },
      data: { status: 'READY', publishedAt: null },
    });

    return { splat: { ...unpublished, sizeBytes: unpublished.sizeBytes ? Number(unpublished.sizeBytes) : null } };
  });
}