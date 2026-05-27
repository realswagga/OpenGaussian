import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export async function publicSplatRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  // GET /api/splats
  app.get('/splats', async () => {
    const splats = await prisma.splat.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        splatCount: true,
        posterKey: true,
        publishedAt: true,
      },
    });

    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';

    return {
      items: splats.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        description: s.description,
        posterUrl: s.posterKey ? `${assetBaseUrl}/${s.posterKey}` : null,
        splatCount: s.splatCount,
        publishedAt: s.publishedAt?.toISOString() ?? null,
      })),
      total: splats.length,
    };
  });

  // GET /api/splats/:slug
  app.get('/splats/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const splat = await prisma.splat.findFirst({
      where: { slug, status: 'PUBLISHED' },
    });

    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    return {
      id: splat.id,
      slug: splat.slug,
      title: splat.title,
      description: splat.description,
      status: splat.status,
      sourceFormat: splat.sourceFormat,
      splatCount: splat.splatCount,
      sizeBytes: splat.sizeBytes ? Number(splat.sizeBytes) : null,
      boundingBoxJson: splat.boundingBoxJson,
      defaultCameraJson: splat.defaultCameraJson,
      globalSettingsJson: splat.globalSettingsJson,
      createdAt: splat.createdAt.toISOString(),
      updatedAt: splat.updatedAt.toISOString(),
      publishedAt: splat.publishedAt?.toISOString() ?? null,
    };
  });

  // GET /api/splats/:slug/manifest
  app.get('/splats/:slug/manifest', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const splat = await prisma.splat.findFirst({
      where: { slug, status: 'PUBLISHED' },
    });

    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';

    const productionUrl = splat.productionObjectKey
      ? `${assetBaseUrl}/${splat.productionObjectKey}`
      : '';
    const productionFormat = (splat.productionFormat || 'ply') as 'sog' | 'sog-meta' | 'lod-meta' | 'ply' | 'compressed-ply' | 'spz';
    const lodManifestKey = splat.lodManifestKey || (productionFormat === 'lod-meta' ? splat.productionObjectKey : null);
    const metaKey = productionFormat === 'sog-meta' ? splat.productionObjectKey : null;

    return {
      id: splat.id,
      slug: splat.slug,
      title: splat.title,
      assets: {
        format: productionFormat,
        sceneUrl: productionUrl,
        lodManifestUrl: lodManifestKey
          ? `${assetBaseUrl}/${lodManifestKey}`
          : undefined,
        metaUrl: metaKey
          ? `${assetBaseUrl}/${metaKey}`
          : undefined,
        posterUrl: splat.posterKey
          ? `${assetBaseUrl}/${splat.posterKey}`
          : undefined,
      },
      viewer: {
        defaultCamera: splat.defaultCameraJson,
        enableVr: true,
        enableWebGpu: true,
        quality: 'auto',
        budgets: {
          desktop: Number(process.env.DEFAULT_LOD_BUDGET) || 1_500_000,
          mobile: Number(process.env.DEFAULT_MOBILE_LOD_BUDGET) || 300_000,
          vr: Number(process.env.DEFAULT_VR_LOD_BUDGET) || 200_000,
        },
        pretransform: splat.pretransformJson || null,
      },
    };
  });

  async function publicMarkers(request: FastifyRequest, reply: FastifyReply) {
    const { slug } = request.params as { slug: string };
    const splat = await prisma.splat.findFirst({
      where: { slug, status: 'PUBLISHED' },
    });

    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }

    const annotations = await prisma.annotation.findMany({
      where: { splatId: splat.id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: annotations.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        kind: a.kind,
        position: [a.positionX, a.positionY, a.positionZ],
        rotation: [a.rotationX, a.rotationY, a.rotationZ],
        scale: a.scale,
        icon: a.icon,
        color: a.color,
      })),
    };
  }

  app.get('/splats/:slug/markers', publicMarkers);
  app.get('/splats/:slug/annotations', publicMarkers);
}
