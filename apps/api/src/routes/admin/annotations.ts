import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Annotation, PrismaClient } from '@prisma/client';
import { createAnnotationSchema, updateAnnotationSchema } from '@gsplat/shared';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { canAccessSplat } from './permissions.js';
import {
  assertVersionBelongsToSplat,
  resolveServedVersion,
  syncSplatMirrorIfServed,
  syncVersionSettingsSnapshot,
} from '../../lib/versionState.js';

export async function adminAnnotationRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.addHook('onRequest', requireAdmin);

  function serializeMarkerListItem(a: Annotation) {
    return {
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
    };
  }

  function serializeMarker(a: Annotation) {
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      kind: a.kind,
      position: [a.positionX, a.positionY, a.positionZ],
      rotation: [a.rotationX, a.rotationY, a.rotationZ],
      scale: a.scale,
      icon: a.icon,
      color: a.color,
      versionId: a.versionId,
    };
  }

  async function resolveMarkerTarget(
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'view' | 'markers',
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
      return { splatId: id, versionId: explicitVersionId };
    }

    const { version } = await resolveServedVersion(prisma, id);
    return { splatId: id, versionId: version?.id ?? null };
  }

  async function listMarkers(request: FastifyRequest, reply: FastifyReply, explicitVersionId?: string) {
    const target = await resolveMarkerTarget(request, reply, 'view', explicitVersionId);
    if (!target) return;

    const annotations = await prisma.annotation.findMany({
      where: target.versionId
        ? { splatId: target.splatId, versionId: target.versionId }
        : { splatId: target.splatId, versionId: null },
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: annotations.map(serializeMarkerListItem),
    };
  }

  async function createMarker(request: FastifyRequest, reply: FastifyReply, legacy: boolean, explicitVersionId?: string) {
    const data = createAnnotationSchema.parse(request.body);
    const target = await resolveMarkerTarget(request, reply, 'markers', explicitVersionId);
    if (!target) return;

    const annotation = await prisma.annotation.create({
      data: {
        splatId: target.splatId,
        versionId: target.versionId,
        ...data,
      },
    });

    if (target.versionId) {
      await syncVersionSettingsSnapshot(prisma, target.splatId, target.versionId).catch(() => undefined);
      await syncSplatMirrorIfServed(prisma, target.splatId, target.versionId);
    }

    const marker = serializeMarker(annotation);
    return legacy ? { annotation: marker } : { marker };
  }

  async function updateMarker(request: FastifyRequest, reply: FastifyReply, legacy: boolean) {
    const { id } = request.params as { id: string };
    const data = updateAnnotationSchema.parse(request.body);

    const existing = await prisma.annotation.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Annotation not found' },
      });
    }
    const access = await canAccessSplat(prisma, request as AuthRequest, existing.splatId, 'markers');
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit markers for this splat' },
      });
    }

    const annotation = await prisma.annotation.update({ where: { id }, data });
    if (annotation.versionId) {
      await syncVersionSettingsSnapshot(prisma, annotation.splatId, annotation.versionId).catch(() => undefined);
      await syncSplatMirrorIfServed(prisma, annotation.splatId, annotation.versionId);
    }

    const marker = serializeMarker(annotation);
    return legacy ? { annotation: marker } : { marker };
  }

  async function deleteMarker(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };

    const existing = await prisma.annotation.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Annotation not found' },
      });
    }
    const access = await canAccessSplat(prisma, request as AuthRequest, existing.splatId, 'markers');
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit markers for this splat' },
      });
    }

    await prisma.annotation.delete({ where: { id } });
    if (existing.versionId) {
      await syncVersionSettingsSnapshot(prisma, existing.splatId, existing.versionId).catch(() => undefined);
      await syncSplatMirrorIfServed(prisma, existing.splatId, existing.versionId);
    }

    return { ok: true };
  }

  app.get('/splats/:id/versions/:versionId/markers', (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return listMarkers(request, reply, versionId);
  });
  app.get('/splats/:id/versions/:versionId/annotations', (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return listMarkers(request, reply, versionId);
  });
  app.get('/splats/:id/markers', (request, reply) => listMarkers(request, reply));
  app.get('/splats/:id/annotations', (request, reply) => listMarkers(request, reply));
  app.post('/splats/:id/versions/:versionId/markers', (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return createMarker(request, reply, false, versionId);
  });
  app.post('/splats/:id/versions/:versionId/annotations', (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    return createMarker(request, reply, true, versionId);
  });
  app.post('/splats/:id/markers', (request, reply) => createMarker(request, reply, false));
  app.post('/splats/:id/annotations', (request, reply) => createMarker(request, reply, true));
  app.patch('/markers/:id', (request, reply) => updateMarker(request, reply, false));
  app.patch('/annotations/:id', (request, reply) => updateMarker(request, reply, true));
  app.delete('/markers/:id', deleteMarker);
  app.delete('/annotations/:id', deleteMarker);
}
