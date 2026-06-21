import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { healthRoutes } from './routes/health.js';
import { publicSplatRoutes } from './routes/public/splats.js';
import { widgetRoutes } from './routes/public/widget.js';
import { authRoutes } from './routes/auth.js';
import { adminSplatRoutes } from './routes/admin/splats.js';
import { adminAnnotationRoutes } from './routes/admin/annotations.js';
import { adminJobRoutes } from './routes/admin/jobs.js';
import { adminUploadRoutes } from './routes/admin/upload.js';
import { adminStatsRoutes } from './routes/admin/stats.js';
import { adminOrganizationRoutes } from './routes/admin/organizations.js';
import { adminSettingsRoutes } from './routes/admin/settings.js';
import { adminTransferRoutes } from './routes/admin/transfer.js';
import { errorHandler } from './middleware/error-handler.js';
import { beginMutation, endMutation, isTransferLocked } from './transfer/barrier.js';
import { enqueueSplatProcessing } from './lib/processingQueue.js';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});

const processingQueue = new Queue('splat-processing', {
  connection: redisConnection,
});

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
  maxParamLength: 200,
});

async function start() {
  // Register plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: (Number(process.env.MAX_UPLOAD_MB) || 2048) * 1024 * 1024,
    },
  });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.addHook('onRequest', async (request, reply) => {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const transferRoute = request.url.startsWith('/api/admin/transfer/');
    const safeAuthRoute = request.url.startsWith('/api/auth/login') || request.url.startsWith('/api/auth/logout');
    if (mutating && !transferRoute && !safeAuthRoute && isTransferLocked()) {
      return reply.status(423).send({ error: { code: 'TRANSFER_IN_PROGRESS', message: 'Project export is in progress' } });
    }
    if (mutating && !transferRoute) beginMutation();
  });
  app.addHook('onResponse', async (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.url.startsWith('/api/admin/transfer/')) endMutation();
  });

  // Decorate with prisma and queue
  app.decorate('prisma', prisma);
  app.decorate('processingQueue', processingQueue);

  // Set error handler
  app.setErrorHandler(errorHandler);

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(publicSplatRoutes, { prefix: '/api' });
  await app.register(widgetRoutes, { prefix: '/api' });
  await app.register(adminStatsRoutes, { prefix: '/api/admin' });
  await app.register(adminSettingsRoutes, { prefix: '/api/admin' });
  await app.register(adminOrganizationRoutes, { prefix: '/api/admin' });
  await app.register(adminSplatRoutes, { prefix: '/api/admin' });
  await app.register(adminAnnotationRoutes, { prefix: '/api/admin' });
  await app.register(adminJobRoutes, { prefix: '/api/admin' });
  await app.register(adminUploadRoutes, { prefix: '/api/admin' });
  await app.register(adminTransferRoutes, { prefix: '/api/admin' });

  // Start server
  const port = Number(process.env.PORT) || 4000;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`API server listening on ${host}:${port}`);
    const reconcileMarker = path.join(process.env.TRANSFER_BACKUP_DIR || '/backups', '.reconcile-queue');
    if (await access(reconcileMarker).then(() => true).catch(() => false)) {
      const unfinished = await prisma.splatVersion.findMany({
        where: { processingStatus: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true, splatId: true, sourceKey: true },
      });
      for (const version of unfinished) {
        await enqueueSplatProcessing(app, prisma, {
          splatId: version.splatId,
          versionId: version.id,
          sourceObjectKey: version.sourceKey,
          jobId: `reconcile-${version.id}`,
        }).catch((error) => app.log.error(error));
      }
      await rm(reconcileMarker, { force: true });
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

export { app, prisma };
