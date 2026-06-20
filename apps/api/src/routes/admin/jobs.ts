import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { canAccessSplat } from './permissions.js';
import { enqueueSplatProcessing } from '../../lib/processingQueue.js';

export async function adminJobRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.addHook('onRequest', requireAdmin);

  // GET /api/admin/jobs/:id
  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const version = await prisma.splatVersion.findUnique({
      where: { id },
      include: { splat: { select: { id: true, slug: true, title: true } } },
    });

    if (!version) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Job/version not found' },
      });
    }
    const access = await canAccessSplat(prisma, request as AuthRequest, version.splatId, 'view');
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Job access denied' },
      });
    }

    return {
      job: {
        id: version.id,
        splatId: version.splatId,
        splatTitle: version.splat.title,
        version: version.version,
        status: version.processingStatus,
        log: version.processingLog,
        metrics: version.metricsJson,
        createdAt: version.createdAt.toISOString(),
        updatedAt: version.updatedAt.toISOString(),
      },
    };
  });

  // GET /api/admin/jobs/:id/events (SSE with live polling)
  app.get('/jobs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };

    const version = await prisma.splatVersion.findUnique({
      where: { id },
      include: { splat: { select: { title: true, slug: true } } },
    });
    if (!version) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Job/version not found' },
      });
    }
    const access = await canAccessSplat(prisma, request as AuthRequest, version.splatId, 'view');
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Job access denied' },
      });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial state
    reply.raw.write(`data: ${JSON.stringify({
      jobId: version.id,
      splatTitle: version.splat.title,
      version: version.version,
      status: version.processingStatus,
      log: version.processingLog,
      metrics: version.metricsJson,
      timestamp: new Date().toISOString(),
    })}\n\n`);

    // If already terminal, close
    if (version.processingStatus === 'READY' || version.processingStatus === 'FAILED') {
      reply.raw.write(`data: ${JSON.stringify({ type: 'done', status: version.processingStatus })}\n\n`);
      reply.raw.end();
      return reply;
    }

    // Poll every 2 seconds for status changes
    const maxPolls = 43_200; // 24 hours; large LOD builds on small hosts can take hours.
    let polls = 0;
    let lastLog = version.processingLog || '';

    const interval = setInterval(async () => {
      polls++;
      try {
        if (polls % 8 === 0) reply.raw.write(': keepalive\n\n');
        const current = await prisma.splatVersion.findUnique({
          where: { id },
          select: { processingStatus: true, processingLog: true, metricsJson: true },
        });

        if (!current) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Job not found' })}\n\n`);
          reply.raw.end();
          clearInterval(interval);
          return;
        }

        const logChanged = current.processingLog !== lastLog;

        if (current.processingStatus !== version.processingStatus || logChanged) {
          lastLog = current.processingLog || '';

          reply.raw.write(`data: ${JSON.stringify({
            jobId: id,
            status: current.processingStatus,
            log: current.processingLog,
            metrics: current.metricsJson,
            timestamp: new Date().toISOString(),
          })}\n\n`);

          if (current.processingStatus === 'READY' || current.processingStatus === 'FAILED') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'done', status: current.processingStatus })}\n\n`);
            reply.raw.end();
            clearInterval(interval);
            return;
          }
        }

        if (polls >= maxPolls) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'timeout', message: 'Polling timeout reached' })}\n\n`);
          reply.raw.end();
          clearInterval(interval);
        }
      } catch (err) {
        clearInterval(interval);
        try { reply.raw.end(); } catch { /* already closed */ }
      }
    }, 2000);

    // Clean up on client disconnect
    request.raw.on('close', () => {
      clearInterval(interval);
    });

    return reply;
  });

  // POST /api/admin/splats/:id/process
  app.post('/splats/:id/process', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'upload');
    if (!access.splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot process this splat' },
      });
    }

    const splat = await prisma.splat.findUnique({
      where: { id },
      include: {
        versions: {
          where: { processingStatus: { in: ['PENDING', 'FAILED'] } },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    const pendingVersion = splat.versions[0];
    if (!pendingVersion) {
      return reply.status(400).send({
        error: {
          code: 'NO_PENDING_VERSION',
          message: 'No pending version to process. Upload a file first.',
        },
      });
    }

    const queued = await enqueueSplatProcessing(app, prisma, {
      splatId: id,
      versionId: pendingVersion.id,
      sourceObjectKey: pendingVersion.sourceKey,
    });

    return {
      jobId: pendingVersion.id,
      version: pendingVersion.version,
      status: queued.status,
      message: queued.status === 'RUNNING' ? 'Processing job enqueued' : 'Processing could not be queued',
      error: queued.status === 'FAILED' ? queued.error : undefined,
    };
  });
}
