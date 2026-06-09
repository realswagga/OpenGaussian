import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Annotation, PrismaClient } from '@prisma/client';
import { createAnnotationSchema, updateAnnotationSchema } from '@gsplat/shared';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { canAccessSplat } from './permissions.js';

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
    };
  }

  async function listMarkers(request: FastifyRequest, reply: FastifyReply) {
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

    const annotations = await prisma.annotation.findMany({
      where: { splatId: id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: annotations.map(serializeMarkerListItem),
    };
  }

  async function createMarker(request: FastifyRequest, reply: FastifyReply, legacy: boolean) {
    const { id } = request.params as { id: string };
    const data = createAnnotationSchema.parse(request.body);

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'markers');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot edit markers for this splat' },
      });
    }

    const annotation = await prisma.annotation.create({
      data: {
        splatId: id,
        ...data,
      },
    });

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

    return { ok: true };
  }

  app.get('/splats/:id/markers', listMarkers);
  app.get('/splats/:id/annotations', listMarkers);
  app.post('/splats/:id/markers', (request, reply) => createMarker(request, reply, false));
  app.post('/splats/:id/annotations', (request, reply) => createMarker(request, reply, true));
  app.patch('/markers/:id', (request, reply) => updateMarker(request, reply, false));
  app.patch('/annotations/:id', (request, reply) => updateMarker(request, reply, true));
  app.delete('/markers/:id', deleteMarker);
  app.delete('/annotations/:id', deleteMarker);
}
