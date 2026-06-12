import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AssetVariantName, SplatAssetFormat, ViewerAssetVariant } from '@gsplat/shared';
import {
  getLandingFeaturedSettings,
  resolveLandingFeaturedSplat,
  serializeFeaturedSplat,
} from '../../lib/landingFeatured.js';

type StoredAssetVariant = {
  format?: SplatAssetFormat;
  sceneKey?: string | null;
  lodManifestKey?: string | null;
  metaKey?: string | null;
  posterKey?: string | null;
  sceneUrl?: string | null;
  lodManifestUrl?: string | null;
  metaUrl?: string | null;
  posterUrl?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assetUrl(assetBaseUrl: string, keyOrUrl?: string | null): string | undefined {
  if (!keyOrUrl) return undefined;
  if (/^https?:\/\//i.test(keyOrUrl) || keyOrUrl.startsWith('/')) return keyOrUrl;
  return `${assetBaseUrl}/${keyOrUrl}`;
}

function serializeOrganization(org: any, publishedSplatCount?: number, assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets') {
  if (!org) return null;
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    description: org.description,
    websiteUrl: org.websiteUrl,
    previewUrl: assetUrl(assetBaseUrl, org.previewKey) ?? null,
    publishedSplatCount: publishedSplatCount ?? org._count?.splats ?? undefined,
    createdAt: org.createdAt?.toISOString?.() ?? org.createdAt,
  };
}

function serializePublicSplat(s: any, assetBaseUrl: string) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description,
    posterUrl: s.posterKey ? `${assetBaseUrl}/${s.posterKey}` : null,
    organization: serializeOrganization(s.organization, undefined, assetBaseUrl),
    splatCount: s.splatCount,
    publishedAt: s.publishedAt?.toISOString() ?? null,
  };
}

function buildManifestVariants(
  settingsJson: unknown,
  assetBaseUrl: string,
): Partial<Record<AssetVariantName, ViewerAssetVariant>> | undefined {
  if (!isRecord(settingsJson) || !isRecord(settingsJson.assetVariants)) return undefined;

  const variants: Partial<Record<AssetVariantName, ViewerAssetVariant>> = {};
  for (const name of ['desktop', 'mobile', 'vr'] as const) {
    const stored = settingsJson.assetVariants[name];
    if (!isRecord(stored)) continue;
    const variant = stored as StoredAssetVariant;
    const sceneUrl = assetUrl(assetBaseUrl, variant.sceneUrl || variant.sceneKey);
    const lodManifestUrl = assetUrl(assetBaseUrl, variant.lodManifestUrl || variant.lodManifestKey);
    const metaUrl = assetUrl(assetBaseUrl, variant.metaUrl || variant.metaKey);
    if (!sceneUrl && !lodManifestUrl && !metaUrl) continue;

    variants[name] = {
      format: variant.format || (lodManifestUrl ? 'lod-meta' : 'ply'),
      sceneUrl,
      lodManifestUrl,
      metaUrl,
      posterUrl: assetUrl(assetBaseUrl, variant.posterUrl || variant.posterKey),
    };
  }

  return Object.keys(variants).length > 0 ? variants : undefined;
}

export async function publicSplatRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  // GET /api/splats
  app.get('/splats', async (request) => {
    const { q, organization } = request.query as { q?: string; organization?: string };
    const splats = await prisma.splat.findMany({
      where: {
        status: 'PUBLISHED',
        ...(q ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
            { organization: { name: { contains: q, mode: 'insensitive' } } },
          ],
        } : {}),
        ...(organization ? { organization: { slug: organization } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      include: { organization: true },
    });

    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';

    return {
      items: splats.map((s) => serializePublicSplat(s, assetBaseUrl)),
      total: splats.length,
    };
  });

  app.get('/search', async (request) => {
    const { q = '' } = request.query as { q?: string };
    const term = q.trim();
    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';

    const [splats, organizations] = await Promise.all([
      prisma.splat.findMany({
        where: {
          status: 'PUBLISHED',
          ...(term ? {
            OR: [
              { title: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term, mode: 'insensitive' } },
              { organization: { name: { contains: term, mode: 'insensitive' } } },
            ],
          } : {}),
        },
        orderBy: { publishedAt: 'desc' },
        take: 60,
        include: { organization: true },
      }),
      prisma.organization.findMany({
        where: {
          isPublic: true,
          ...(term ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term, mode: 'insensitive' } },
            ],
          } : {}),
          splats: { some: { status: 'PUBLISHED' } },
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { splats: { where: { status: 'PUBLISHED' } } } },
        },
        take: 30,
      }),
    ]);

    return {
      query: term,
      splats: splats.map((s) => serializePublicSplat(s, assetBaseUrl)),
      organizations: organizations.map((org) => serializeOrganization(org, org._count.splats, assetBaseUrl)),
    };
  });

  app.get('/landing-featured', async () => {
    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';
    const settings = await getLandingFeaturedSettings(prisma);
    const splat = await resolveLandingFeaturedSplat(prisma, settings);

    return {
      settings,
      splat: serializeFeaturedSplat(splat, assetBaseUrl),
    };
  });

  app.get('/organizations', async () => {
    const organizations = await prisma.organization.findMany({
      where: { isPublic: true, splats: { some: { status: 'PUBLISHED' } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { splats: { where: { status: 'PUBLISHED' } } } },
      },
    });
    return {
      items: organizations.map((org) => serializeOrganization(org, org._count.splats, process.env.ASSET_PUBLIC_URL || '/assets')),
      total: organizations.length,
    };
  });

  app.get('/organizations/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const organization = await prisma.organization.findFirst({
      where: { slug, isPublic: true },
      include: {
        splats: {
          where: { status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          include: { organization: true },
        },
        _count: { select: { splats: { where: { status: 'PUBLISHED' } } } },
      },
    });
    if (!organization) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
    }

    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';
    return {
      organization: serializeOrganization(organization, organization._count.splats, assetBaseUrl),
      splats: organization.splats.map((s) => serializePublicSplat(s, assetBaseUrl)),
    };
  });

  // GET /api/splats/:slug
  app.get('/splats/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const splat = await prisma.splat.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: { organization: true },
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
      organization: serializeOrganization(splat.organization, undefined, process.env.ASSET_PUBLIC_URL || '/assets'),
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
    const variants = buildManifestVariants(splat.globalSettingsJson, assetBaseUrl);

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
        variants,
      },
      viewer: {
        defaultCamera: splat.defaultCameraJson,
        enableVr: true,
        enableWebGpu: true,
        quality: 'auto',
        budgets: {
          desktop: Number(process.env.DEFAULT_LOD_BUDGET) || 900_000,
          mobile: Number(process.env.DEFAULT_MOBILE_LOD_BUDGET) || 250_000,
          vr: Number(process.env.DEFAULT_VR_LOD_BUDGET) || 60_000,
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
