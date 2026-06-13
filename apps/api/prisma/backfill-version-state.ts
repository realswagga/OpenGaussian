import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  asJson,
  copyPosterToVersionPath,
  setServedVersion,
  stripAssetVariants,
  syncVersionSettingsSnapshot,
} from '../src/lib/versionState.js';

const prisma = new PrismaClient();

async function main() {
  const splats = await prisma.splat.findMany({
    include: {
      versions: { orderBy: { version: 'desc' } },
      annotations: { where: { versionId: null }, orderBy: { createdAt: 'asc' } },
    },
  });

  for (const splat of splats) {
    if (splat.versions.length === 0) continue;

    const served =
      splat.versions.find((version) => version.id === splat.servingVersionId) ||
      splat.versions.find((version) => version.convertedKey && version.convertedKey === splat.productionObjectKey) ||
      splat.versions.find((version) => version.processingStatus === 'READY') ||
      splat.versions[0]!;

    if (served.processingStatus === 'READY' && splat.servingVersionId !== served.id) {
      await setServedVersion(prisma, splat.id, served.id);
    }

    const editorState = {
      defaultCameraJson: asJson(splat.defaultCameraJson),
      globalSettingsJson: asJson(stripAssetVariants(splat.globalSettingsJson)),
      pretransformJson: asJson(splat.pretransformJson),
    };

    for (const version of splat.versions) {
      const posterKey = version.posterKey ?? await copyPosterToVersionPath(
        splat.id,
        version.id,
        splat.posterKey,
      );
      await prisma.splatVersion.update({
        where: { id: version.id },
        data: {
          posterKey,
          productionFormat: version.productionFormat || splat.productionFormat,
          splatCount: version.splatCount ?? splat.splatCount,
          sizeBytes: version.sizeBytes ?? splat.sizeBytes,
          boundingBoxJson: version.boundingBoxJson ?? asJson(splat.boundingBoxJson),
          ...editorState,
        },
      });
    }

    const legacyMarkers = splat.annotations;
    if (legacyMarkers.length > 0) {
      for (const version of splat.versions) {
        if (version.id === served.id) continue;
        const existingCount = await prisma.annotation.count({
          where: { splatId: splat.id, versionId: version.id },
        });
        if (existingCount > 0) continue;

        await prisma.annotation.createMany({
          data: legacyMarkers.map((marker) => ({
            splatId: splat.id,
            versionId: version.id,
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

      await prisma.annotation.updateMany({
        where: { splatId: splat.id, versionId: null },
        data: { versionId: served.id },
      });
    }

    for (const version of splat.versions) {
      await syncVersionSettingsSnapshot(prisma, splat.id, version.id).catch((err) => {
        console.warn(`Snapshot sync failed for ${splat.slug} v${version.version}:`, err);
      });
    }

    console.log(`Backfilled ${splat.slug}: served v${served.version}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
