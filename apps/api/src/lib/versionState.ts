import type { PrismaClient, Splat, SplatVersion, Annotation } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CopyObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

type JsonLike = Prisma.InputJsonValue | typeof Prisma.JsonNull;

type SplatWithVersions = Splat & {
  servingVersion?: SplatVersion | null;
  versions?: SplatVersion[];
};

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
});

const S3_BUCKET = process.env.S3_BUCKET || 'gsplat-assets';

export const servedVersionInclude = {
  servingVersion: true,
  versions: {
    where: { processingStatus: 'READY' as const },
    orderBy: { version: 'desc' as const },
    take: 1,
  },
};

export const editorStateVersionInclude = {
  annotations: { orderBy: { createdAt: 'asc' as const } },
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function stripAssetVariants(value: unknown): unknown {
  if (!isRecord(value)) return value ?? null;
  const { assetVariants: _assetVariants, ...rest } = value;
  return rest;
}

export function asJson(value: unknown): JsonLike {
  return value === undefined || value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

export function pickServedVersion(splat: SplatWithVersions): SplatVersion | null {
  return splat.servingVersion ?? splat.versions?.[0] ?? null;
}

export function versionProductionFormat(splat: Splat, version?: SplatVersion | null): string | null {
  if (version?.productionFormat) return version.productionFormat;
  if (splat.productionFormat) return splat.productionFormat;
  const metrics = isRecord(version?.metricsJson) ? version.metricsJson : null;
  return typeof metrics?.format === 'string' ? metrics.format : null;
}

export function versionConvertedKey(splat: Splat, version?: SplatVersion | null): string | null {
  return version?.convertedKey ?? splat.productionObjectKey ?? null;
}

export function versionLodKey(splat: Splat, version?: SplatVersion | null): string | null {
  const convertedKey = versionConvertedKey(splat, version);
  const format = versionProductionFormat(splat, version);
  return version?.lodKey ?? splat.lodManifestKey ?? (format === 'lod-meta' ? convertedKey : null);
}

export function versionMetaKey(splat: Splat, version?: SplatVersion | null): string | null {
  const convertedKey = versionConvertedKey(splat, version);
  return versionProductionFormat(splat, version) === 'sog-meta' ? convertedKey : null;
}

export function versionPosterKey(splat: Splat, version?: SplatVersion | null): string | null {
  return version?.posterKey ?? splat.posterKey ?? null;
}

export function versionSplatCount(splat: Splat, version?: SplatVersion | null): number | null {
  return version?.splatCount ?? splat.splatCount ?? null;
}

export function versionSizeBytes(splat: Splat, version?: SplatVersion | null): bigint | null {
  return version?.sizeBytes ?? splat.sizeBytes ?? null;
}

export function versionBoundingBox(splat: Splat, version?: SplatVersion | null): unknown {
  return version?.boundingBoxJson ?? splat.boundingBoxJson ?? null;
}

export function versionDefaultCamera(splat: Splat, version?: SplatVersion | null): unknown {
  return version?.defaultCameraJson ?? splat.defaultCameraJson ?? null;
}

export function versionGlobalSettings(splat: Splat, version?: SplatVersion | null): unknown {
  return version?.globalSettingsJson ?? splat.globalSettingsJson ?? null;
}

export function versionPretransform(splat: Splat, version?: SplatVersion | null): unknown {
  return version?.pretransformJson ?? splat.pretransformJson ?? null;
}

export function splatMirrorData(splat: Splat, version: SplatVersion) {
  return {
    productionFormat: versionProductionFormat(splat, version),
    productionObjectKey: versionConvertedKey(splat, version),
    lodManifestKey: versionLodKey(splat, version),
    posterKey: versionPosterKey(splat, version),
    splatCount: versionSplatCount(splat, version),
    sizeBytes: versionSizeBytes(splat, version),
    boundingBoxJson: asJson(versionBoundingBox(splat, version)),
    defaultCameraJson: asJson(versionDefaultCamera(splat, version)),
    globalSettingsJson: asJson(versionGlobalSettings(splat, version)),
    pretransformJson: asJson(versionPretransform(splat, version)),
  };
}

function encodeCopySourceKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export async function copyPosterToVersionPath(
  splatId: string,
  targetVersionId: string,
  sourceKey?: string | null,
): Promise<string | null> {
  if (!sourceKey) return null;
  const targetPrefix = `splats/${splatId}/versions/${targetVersionId}/preview/`;
  if (sourceKey.startsWith(targetPrefix)) return sourceKey;

  const filename = sourceKey.split('/').pop() || 'poster.jpg';
  const targetKey = `${targetPrefix}copied-${Date.now()}-${randomUUID()}-${filename}`;
  try {
    await s3Client.send(new CopyObjectCommand({
      Bucket: S3_BUCKET,
      CopySource: `${S3_BUCKET}/${encodeCopySourceKey(sourceKey)}`,
      Key: targetKey,
    }));
    return targetKey;
  } catch {
    return sourceKey;
  }
}

export async function resolveServedVersion(prisma: PrismaClient, splatId: string) {
  const splat = await prisma.splat.findUnique({
    where: { id: splatId },
    include: servedVersionInclude,
  });
  if (!splat) return { splat: null, version: null };
  return { splat, version: pickServedVersion(splat) };
}

export async function assertVersionBelongsToSplat(
  prisma: PrismaClient,
  splatId: string,
  versionId: string,
): Promise<SplatVersion | null> {
  return prisma.splatVersion.findFirst({
    where: { id: versionId, splatId },
  });
}

export async function setServedVersion(prisma: PrismaClient, splatId: string, versionId: string) {
  const splat = await prisma.splat.findUnique({ where: { id: splatId } });
  if (!splat) return null;

  const version = await prisma.splatVersion.findFirst({
    where: { id: versionId, splatId, processingStatus: 'READY' },
  });
  if (!version) return null;

  const updated = await prisma.splat.update({
    where: { id: splatId },
    data: {
      servingVersionId: version.id,
      ...splatMirrorData(splat, version),
    },
    include: { servingVersion: true },
  });

  return { splat: updated, version };
}

export async function syncSplatMirrorIfServed(
  prisma: PrismaClient,
  splatId: string,
  versionId: string,
): Promise<void> {
  const splat = await prisma.splat.findUnique({ where: { id: splatId } });
  if (!splat || splat.servingVersionId !== versionId) return;

  const version = await prisma.splatVersion.findFirst({
    where: { id: versionId, splatId },
  });
  if (!version) return;

  await prisma.splat.update({
    where: { id: splatId },
    data: splatMirrorData(splat, version),
  });
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

export async function syncVersionSettingsSnapshot(
  prisma: PrismaClient,
  splatId: string,
  versionId: string,
): Promise<string | null> {
  const version = await prisma.splatVersion.findFirst({
    where: { id: versionId, splatId },
    include: editorStateVersionInclude,
  });
  if (!version) return null;

  const settingsKey = `splats/${splatId}/versions/${versionId}/settings.json`;
  const snapshot = {
    schemaVersion: 1,
    splatId,
    versionId,
    version: version.version,
    productionFormat: version.productionFormat,
    convertedKey: version.convertedKey,
    lodKey: version.lodKey,
    posterKey: version.posterKey,
    splatCount: version.splatCount,
    sizeBytes: version.sizeBytes ? Number(version.sizeBytes) : null,
    boundingBox: version.boundingBoxJson,
    defaultCamera: version.defaultCameraJson,
    globalSettings: version.globalSettingsJson,
    pretransform: version.pretransformJson,
    markers: version.annotations.map(serializeMarker),
    updatedAt: new Date().toISOString(),
  };

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: settingsKey,
    Body: JSON.stringify(snapshot, null, 2),
    ContentType: 'application/json',
  }));

  if (version.settingsKey !== settingsKey) {
    await prisma.splatVersion.update({
      where: { id: versionId },
      data: { settingsKey },
    });
  }

  return settingsKey;
}

export async function cloneServedEditorStateToVersion(
  prisma: PrismaClient,
  splatId: string,
  targetVersionId: string,
): Promise<void> {
  const splat = await prisma.splat.findUnique({
    where: { id: splatId },
    include: {
      servingVersion: true,
      versions: {
        where: { processingStatus: 'READY', id: { not: targetVersionId } },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });
  if (!splat) return;

  const sourceVersion = pickServedVersion(splat);
  const posterKey = await copyPosterToVersionPath(
    splatId,
    targetVersionId,
    sourceVersion?.posterKey ?? splat.posterKey,
  );
  const state = {
    posterKey,
    defaultCameraJson: asJson(sourceVersion?.defaultCameraJson ?? splat.defaultCameraJson),
    globalSettingsJson: asJson(stripAssetVariants(sourceVersion?.globalSettingsJson ?? splat.globalSettingsJson)),
    pretransformJson: asJson(sourceVersion?.pretransformJson ?? splat.pretransformJson),
  };

  await prisma.splatVersion.update({
    where: { id: targetVersionId },
    data: state,
  });

  const sourceMarkers = sourceVersion
    ? await prisma.annotation.findMany({
        where: { splatId, versionId: sourceVersion.id },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const legacyMarkers = sourceMarkers.length > 0
    ? []
    : await prisma.annotation.findMany({
        where: { splatId, versionId: null },
        orderBy: { createdAt: 'asc' },
      });
  const markers = sourceMarkers.length > 0 ? sourceMarkers : legacyMarkers;

  if (markers.length > 0) {
    await prisma.annotation.createMany({
      data: markers.map((marker) => ({
        splatId,
        versionId: targetVersionId,
        title: marker.title,
        body: marker.body,
        kind: marker.kind,
        positionX: marker.positionX,
        positionY: marker.positionY,
        positionZ: marker.positionZ,
        rotationX: marker.rotationX,
        rotationY: marker.rotationY,
        rotationZ: marker.rotationZ,
        scale: marker.scale,
        icon: marker.icon,
        color: marker.color,
        visibilityRulesJson: asJson(marker.visibilityRulesJson),
        mediaJson: asJson(marker.mediaJson),
      })),
    });
  }

  await syncVersionSettingsSnapshot(prisma, splatId, targetVersionId).catch(() => undefined);
}
