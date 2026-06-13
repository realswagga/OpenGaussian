import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createSplatSchema, updateSplatSchema, pretransformSchema, pretransformUpdateSchema, defaultCameraSchema } from '@gsplat/shared';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { accessibleOrganizationIds, canAccessSplat, canCreateSplatInOrganization } from './permissions.js';
import {
  asJson,
  assertVersionBelongsToSplat,
  editorStateVersionInclude,
  resolveServedVersion,
  servedVersionInclude,
  setServedVersion,
  syncSplatMirrorIfServed,
  syncVersionSettingsSnapshot,
  versionBoundingBox,
  versionConvertedKey,
  versionDefaultCamera,
  versionGlobalSettings,
  versionLodKey,
  versionPosterKey,
  versionPretransform,
  versionProductionFormat,
  versionSizeBytes,
  versionSplatCount,
} from '../../lib/versionState.js';

export async function adminSplatRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  // All admin routes require admin/editor role
  app.addHook('onRequest', requireAdmin);

  function serializeVersion(v: any, servedVersionId?: string | null) {
    return {
      id: v.id,
      splatId: v.splatId,
      version: v.version,
      sourceKey: v.sourceKey,
      convertedKey: v.convertedKey,
      lodKey: v.lodKey,
      posterKey: v.posterKey,
      productionFormat: v.productionFormat,
      splatCount: v.splatCount,
      sizeBytes: v.sizeBytes ? Number(v.sizeBytes) : null,
      settingsKey: v.settingsKey,
      processingStatus: v.processingStatus,
      processingLog: v.processingLog,
      metrics: v.metricsJson,
      markerCount: v._count?.annotations ?? v.annotations?.length ?? 0,
      isServed: servedVersionId === v.id,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  function pickAdminServedVersion(s: any) {
    if (s.servingVersion) return s.servingVersion;
    if (!Array.isArray(s.versions)) return null;
    return (
      s.versions.find((v: any) => v.id === s.servingVersionId) ||
      s.versions.find((v: any) => v.processingStatus === 'READY') ||
      null
    );
  }

  function serializeSplat(s: any) {
    const served = pickAdminServedVersion(s);
    return {
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      status: s.status,
      sourceFormat: s.sourceFormat,
      sourceObjectKey: s.sourceObjectKey,
      organizationId: s.organizationId,
      organization: s.organization ? {
        id: s.organization.id,
        slug: s.organization.slug,
        name: s.organization.name,
        description: s.organization.description,
      } : null,
      servingVersionId: served?.id ?? s.servingVersionId ?? null,
      productionFormat: versionProductionFormat(s, served),
      productionObjectKey: versionConvertedKey(s, served),
      lodManifestKey: versionLodKey(s, served),
      posterKey: versionPosterKey(s, served),
      splatCount: versionSplatCount(s, served),
      sizeBytes: versionSizeBytes(s, served) ? Number(versionSizeBytes(s, served)) : null,
      boundingBoxJson: versionBoundingBox(s, served),
      defaultCameraJson: versionDefaultCamera(s, served),
      globalSettingsJson: versionGlobalSettings(s, served),
      pretransformJson: versionPretransform(s, served),
      annotationCount: s._count?.annotations,
      versionCount: s._count?.versions,
      versions: Array.isArray(s.versions)
        ? s.versions.map((v: any) => serializeVersion(v, served?.id ?? s.servingVersionId))
        : undefined,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      publishedAt: s.publishedAt?.toISOString() ?? null,
    };
  }

  // GET /api/admin/splats
  app.get('/splats', async (request) => {
    const orgIds = await accessibleOrganizationIds(prisma, request as AuthRequest);
    const splats = await prisma.splat.findMany({
      where: orgIds === null ? {} : { organizationId: { in: orgIds } },
      orderBy: { updatedAt: 'desc' },
      include: {
        ...servedVersionInclude,
        _count: { select: { annotations: true, versions: true } },
        organization: { select: { id: true, slug: true, name: true, description: true } },
      },
    });

    return {
      items: splats.map(serializeSplat),
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
        servingVersion: true,
        annotations: true,
        versions: {
          orderBy: { version: 'desc' },
          include: { _count: { select: { annotations: true } } },
        },
        _count: { select: { annotations: true, versions: true } },
        organization: { select: { id: true, slug: true, name: true, description: true } },
      },
    });

    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    return {
      splat: serializeSplat(splat),
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

    // Only allow publishing if there's a ready version. If no served version is
    // selected yet, default to the newest ready version once.
    const readyVersion = await prisma.splatVersion.findFirst({
      where: { splatId: id, processingStatus: 'READY' },
      orderBy: { version: 'desc' },
    });

    if (!readyVersion) {
      return reply.status(400).send({
        error: { code: 'NO_READY_VERSION', message: 'No ready version available. Process a version first.' },
      });
    }

    if (!splat.servingVersionId) {
      await setServedVersion(prisma, id, readyVersion.id);
      await syncVersionSettingsSnapshot(prisma, id, readyVersion.id).catch(() => undefined);
    }

    const published = await prisma.splat.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      include: servedVersionInclude,
    });

    return { splat: serializeSplat(published) };
  });

  // ── Pretransform endpoints ──

  async function resolveEditorTarget(
    request: any,
    reply: any,
    action: 'edit' | 'view',
    explicitVersionId?: string,
  ) {
    const { id } = request.params as { id: string };
    const access = await canAccessSplat(prisma, request as AuthRequest, id, action);
    if (!access.splat) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Splat not found' } });
      return null;
    }
    if (!access.ok) {
      reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Splat access denied' } });
      return null;
    }
    if (explicitVersionId) {
      const version = await assertVersionBelongsToSplat(prisma, id, explicitVersionId);
      if (!version) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
        return null;
      }
      return { splat: access.splat, version };
    }
    const resolved = await resolveServedVersion(prisma, id);
    return { splat: access.splat, version: resolved.version };
  }

  async function getTransform(request: any, reply: any, explicitVersionId?: string) {
    const { id } = request.params as { id: string };
    const target = await resolveEditorTarget(request, reply, 'view', explicitVersionId);
    if (!target) return;
    if (target.version) return { pretransform: target.version.pretransformJson || null };
    const splat = await prisma.splat.findUnique({ where: { id }, select: { pretransformJson: true } });
    return { pretransform: splat?.pretransformJson || null };
  }

  app.get('/splats/:id/versions/:versionId/transform', async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return getTransform(request, reply, versionId);
  });
  app.get('/splats/:id/transform', (request, reply) => getTransform(request, reply));

  async function patchTransform(request: any, reply: any, explicitVersionId?: string) {
    const { id } = request.params as { id: string };
    const data = pretransformUpdateSchema.parse(request.body);
    const target = await resolveEditorTarget(request, reply, 'edit', explicitVersionId);
    if (!target) return;

    // Merge with existing pretransform if partial update
    const existing = (target.version?.pretransformJson || target.splat.pretransformJson || { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }) as Record<string, number[]>;
    const merged = {
      position: data.position || existing.position || [0, 0, 0],
      rotation: data.rotation || existing.rotation || [0, 0, 0],
      scale: data.scale || existing.scale || [1, 1, 1],
    };

    // Validate full shape
    pretransformSchema.parse(merged);

    if (target.version) {
      const updated = await prisma.splatVersion.update({
        where: { id: target.version.id },
        data: { pretransformJson: asJson(merged) },
        select: { pretransformJson: true },
      });
      await syncVersionSettingsSnapshot(prisma, id, target.version.id).catch(() => undefined);
      await syncSplatMirrorIfServed(prisma, id, target.version.id);
      return { pretransform: updated.pretransformJson };
    }

    const updated = await prisma.splat.update({
      where: { id },
      data: { pretransformJson: merged },
      select: { pretransformJson: true },
    });

    return { pretransform: updated.pretransformJson };
  }

  app.patch('/splats/:id/versions/:versionId/transform', async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return patchTransform(request, reply, versionId);
  });
  app.patch('/splats/:id/transform', (request, reply) => patchTransform(request, reply));

  // ── Default Camera endpoints ──

  async function patchCamera(request: any, reply: any, explicitVersionId?: string) {
    const { id } = request.params as { id: string };
    const data = defaultCameraSchema.parse(request.body);
    const target = await resolveEditorTarget(request, reply, 'edit', explicitVersionId);
    if (!target) return;

    if (target.version) {
      const updated = await prisma.splatVersion.update({
        where: { id: target.version.id },
        data: { defaultCameraJson: asJson(data) },
        select: { defaultCameraJson: true },
      });
      await syncVersionSettingsSnapshot(prisma, id, target.version.id).catch(() => undefined);
      await syncSplatMirrorIfServed(prisma, id, target.version.id);
      return { defaultCamera: updated.defaultCameraJson };
    }

    const updated = await prisma.splat.update({
      where: { id },
      data: { defaultCameraJson: data },
      select: { defaultCameraJson: true },
    });

    return { defaultCamera: updated.defaultCameraJson };
  }

  app.patch('/splats/:id/versions/:versionId/camera', async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return patchCamera(request, reply, versionId);
  });
  app.patch('/splats/:id/camera', (request, reply) => patchCamera(request, reply));

  async function deleteCamera(request: any, reply: any, explicitVersionId?: string) {
    const { id } = request.params as { id: string };
    const target = await resolveEditorTarget(request, reply, 'edit', explicitVersionId);
    if (!target) return;

    if (target.version) {
      await prisma.splatVersion.update({
        where: { id: target.version.id },
        data: { defaultCameraJson: Prisma.JsonNull },
        select: { defaultCameraJson: true },
      });
      await syncVersionSettingsSnapshot(prisma, id, target.version.id).catch(() => undefined);
      await syncSplatMirrorIfServed(prisma, id, target.version.id);
      return { defaultCamera: null };
    }

    await prisma.splat.update({
      where: { id },
      data: { defaultCameraJson: Prisma.JsonNull },
      select: { defaultCameraJson: true },
    });

    return { defaultCamera: null };
  }

  app.delete('/splats/:id/versions/:versionId/camera', async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return deleteCamera(request, reply, versionId);
  });
  app.delete('/splats/:id/camera', (request, reply) => deleteCamera(request, reply));

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

    const splat = await prisma.splat.findUnique({
      where: { id },
      select: { servingVersionId: true },
    });
    const versions = await prisma.splatVersion.findMany({
      where: { splatId: id },
      orderBy: { version: 'desc' },
      include: { _count: { select: { annotations: true } } },
    });

    return {
      items: versions.map((v) => serializeVersion(v, splat?.servingVersionId)),
    };
  });

  // POST /api/admin/splats/:id/versions/:versionId/serve
  app.post('/splats/:id/versions/:versionId/serve', async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'publish');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot change the served version for this splat' },
      });
    }

    const result = await setServedVersion(prisma, id, versionId);
    if (!result) {
      return reply.status(400).send({
        error: { code: 'VERSION_NOT_READY', message: 'Only ready versions can be served' },
      });
    }
    await syncVersionSettingsSnapshot(prisma, id, versionId).catch(() => undefined);

    const fresh = await prisma.splat.findUnique({
      where: { id },
      include: {
        ...servedVersionInclude,
        _count: { select: { annotations: true, versions: true } },
        organization: { select: { id: true, slug: true, name: true, description: true } },
      },
    });

    return {
      splat: fresh ? serializeSplat(fresh) : null,
      version: serializeVersion(result.version, versionId),
    };
  });

  // GET /api/admin/splats/:id/versions/:versionId/editor-state
  app.get('/splats/:id/versions/:versionId/editor-state', async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
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

    const version = await prisma.splatVersion.findFirst({
      where: { id: versionId, splatId: id },
      include: editorStateVersionInclude,
    });
    if (!version) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Version not found' },
      });
    }

    const splat = await prisma.splat.findUnique({
      where: { id },
      include: {
        servingVersion: true,
        versions: { where: { id: versionId }, take: 1 },
        _count: { select: { annotations: true, versions: true } },
        organization: { select: { id: true, slug: true, name: true, description: true } },
      },
    });

    return {
      splat: splat ? {
        ...serializeSplat({
          ...splat,
          servingVersion: version,
          versions: [version],
        }),
        servingVersionId: splat.servingVersionId,
      } : null,
      version: serializeVersion(version, splat?.servingVersionId),
      markers: version.annotations.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        kind: a.kind,
        positionX: a.positionX,
        positionY: a.positionY,
        positionZ: a.positionZ,
        rotationX: a.rotationX,
        rotationY: a.rotationY,
        rotationZ: a.rotationZ,
        scale: a.scale,
        icon: a.icon,
        color: a.color,
        splatId: a.splatId,
        versionId: a.versionId,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
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
