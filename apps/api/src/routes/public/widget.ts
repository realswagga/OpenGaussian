import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export async function widgetRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  // GET /api/widget/:slug/config
  app.get('/widget/:slug/config', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const splat = await prisma.splat.findUnique({
      where: { slug, status: 'PUBLISHED' },
    });

    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    const apiBaseUrl = process.env.API_PUBLIC_URL || '/api';

    return {
      scene: {
        slug: splat.slug,
        title: splat.title,
        description: splat.description,
        manifestUrl: `${apiBaseUrl}/splats/${splat.slug}/manifest`,
        markersUrl: `${apiBaseUrl}/splats/${splat.slug}/markers`,
        annotationsUrl: `${apiBaseUrl}/splats/${splat.slug}/annotations`,
      },
      widget: {
        locked: false,
        showMarkers: true,
        showUi: true,
        enableVr: true,
        quality: 'auto',
      },
    };
  });
}
