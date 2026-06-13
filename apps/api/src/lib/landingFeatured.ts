import type { PrismaClient } from '@prisma/client';
import type { LandingFeaturedMode, LandingFeaturedSettings } from '@gsplat/shared';
import { pickServedVersion, servedVersionInclude, versionPosterKey, versionSplatCount } from './versionState.js';

export const LANDING_FEATURED_SETTING_KEY = 'landing-featured';

const defaultSettings: LandingFeaturedSettings = {
  mode: 'latest',
  selectedSplatId: null,
};

function assetUrl(assetBaseUrl: string, key?: string | null): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key) || key.startsWith('/')) return key;
  return `${assetBaseUrl}/${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isLandingFeaturedMode(value: unknown): value is LandingFeaturedMode {
  return value === 'manual' || value === 'latest' || value === 'random';
}

export function parseLandingFeaturedSettings(value: unknown): LandingFeaturedSettings {
  if (!isRecord(value)) return defaultSettings;
  return {
    mode: isLandingFeaturedMode(value.mode) ? value.mode : defaultSettings.mode,
    selectedSplatId: typeof value.selectedSplatId === 'string' ? value.selectedSplatId : null,
  };
}

export async function getLandingFeaturedSettings(prisma: PrismaClient): Promise<LandingFeaturedSettings> {
  const stored = await prisma.appSetting.findUnique({
    where: { key: LANDING_FEATURED_SETTING_KEY },
  });
  return parseLandingFeaturedSettings(stored?.value);
}

export async function saveLandingFeaturedSettings(
  prisma: PrismaClient,
  settings: LandingFeaturedSettings,
): Promise<LandingFeaturedSettings> {
  const value = {
    mode: settings.mode,
    selectedSplatId: settings.selectedSplatId,
  };

  await prisma.appSetting.upsert({
    where: { key: LANDING_FEATURED_SETTING_KEY },
    update: { value },
    create: { key: LANDING_FEATURED_SETTING_KEY, value },
  });

  return value;
}

export function serializeFeaturedSplat(s: any, assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets') {
  if (!s) return null;
  const served = pickServedVersion(s);
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description,
    posterUrl: assetUrl(assetBaseUrl, versionPosterKey(s, served)),
    organization: s.organization ? {
      id: s.organization.id,
      slug: s.organization.slug,
      name: s.organization.name,
      description: s.organization.description,
      websiteUrl: s.organization.websiteUrl,
      previewUrl: assetUrl(assetBaseUrl, s.organization.previewKey),
      createdAt: s.organization.createdAt?.toISOString?.() ?? s.organization.createdAt,
    } : null,
    splatCount: versionSplatCount(s, served),
    publishedAt: s.publishedAt?.toISOString?.() ?? s.publishedAt ?? null,
  };
}

export async function resolveLandingFeaturedSplat(prisma: PrismaClient, settings: LandingFeaturedSettings) {
  const include = { organization: true, ...servedVersionInclude };
  const where = { status: 'PUBLISHED' as const };

  if (settings.mode === 'manual' && settings.selectedSplatId) {
    const selected = await prisma.splat.findFirst({
      where: { ...where, id: settings.selectedSplatId },
      include,
    });
    if (selected) return selected;
  }

  if (settings.mode === 'random') {
    const count = await prisma.splat.count({ where });
    if (count > 0) {
      const [random] = await prisma.splat.findMany({
        where,
        include,
        orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: Math.floor(Math.random() * count),
        take: 1,
      });
      if (random) return random;
    }
  }

  return prisma.splat.findFirst({
    where,
    include,
    orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function listFeaturedSplatOptions(prisma: PrismaClient) {
  return prisma.splat.findMany({
    where: { status: 'PUBLISHED' },
    include: { organization: true, ...servedVersionInclude },
    orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
  });
}
