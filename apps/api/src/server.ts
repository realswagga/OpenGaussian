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
import { errorHandler } from './middleware/error-handler.js';

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
  await app.register(adminOrganizationRoutes, { prefix: '/api/admin' });
  await app.register(adminSplatRoutes, { prefix: '/api/admin' });
  await app.register(adminAnnotationRoutes, { prefix: '/api/admin' });
  await app.register(adminJobRoutes, { prefix: '/api/admin' });
  await app.register(adminUploadRoutes, { prefix: '/api/admin' });

  // Start server
  const port = Number(process.env.PORT) || 4000;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`API server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

export { app, prisma };
