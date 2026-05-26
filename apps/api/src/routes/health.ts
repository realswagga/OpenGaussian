import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    return {
      ok: true,
      service: 'gsplat-api',
      time: new Date().toISOString(),
    };
  });
}