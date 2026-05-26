import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../../middleware/auth.js';

export async function adminStatsRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.addHook('onRequest', requireAdmin);

  // GET /api/admin/stats
  app.get('/stats', async () => {
    const [
      totalSplats,
      publishedSplats,
      draftSplats,
      processingSplats,
      failedSplats,
      readySplats,
      archivedSplats,
      totalAnnotations,
      activeJobs,
    ] = await Promise.all([
      prisma.splat.count(),
      prisma.splat.count({ where: { status: 'PUBLISHED' } }),
      prisma.splat.count({ where: { status: 'DRAFT' } }),
      prisma.splat.count({ where: { status: 'PROCESSING' } }),
      prisma.splat.count({ where: { status: 'FAILED' } }),
      prisma.splat.count({ where: { status: 'READY' } }),
      prisma.splat.count({ where: { status: 'ARCHIVED' } }),
      prisma.annotation.count(),
      prisma.splatVersion.count({ where: { processingStatus: { in: ['PENDING', 'RUNNING'] } } }),
    ]);

    // Recent jobs (last 10 version records)
    const recentVersions = await prisma.splatVersion.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { splat: { select: { title: true } } },
    });

    const recentJobs = recentVersions.map((v) => ({
      id: v.id,
      splatId: v.splatId,
      splatTitle: v.splat.title,
      version: v.version,
      status: v.processingStatus,
      log: v.processingLog,
      createdAt: v.createdAt.toISOString(),
    }));

    // Storage estimate — sum of all version file sizes from metrics
    let storageBytesEstimate = 0;
    try {
      const versions = await prisma.splatVersion.findMany({
        select: { metricsJson: true },
      });
      for (const v of versions) {
        const metrics = v.metricsJson as { fileSize?: number } | null;
        if (metrics?.fileSize) {
          storageBytesEstimate += metrics.fileSize;
        }
      }
    } catch {
      // Ignore storage calculation failures
    }

    // Also add splat sizeBytes
    const splats = await prisma.splat.findMany({
      where: { sizeBytes: { not: null } },
      select: { sizeBytes: true },
    });
    for (const s of splats) {
      if (s.sizeBytes) {
        storageBytesEstimate += Number(s.sizeBytes);
      }
    }

    return {
      totalSplats,
      publishedSplats,
      draftSplats,
      processingSplats,
      failedSplats,
      readySplats,
      archivedSplats,
      totalAnnotations,
      activeJobs,
      storageBytesEstimate,
      recentJobs,
    };
  });
}
