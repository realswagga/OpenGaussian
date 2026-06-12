import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin, type AuthRequest, isMasterRole } from '../../middleware/auth.js';
import {
  getLandingFeaturedSettings,
  isLandingFeaturedMode,
  listFeaturedSplatOptions,
  resolveLandingFeaturedSplat,
  saveLandingFeaturedSettings,
  serializeFeaturedSplat,
} from '../../lib/landingFeatured.js';

export async function adminSettingsRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.addHook('onRequest', requireAdmin);

  async function requireMaster(request: AuthRequest, reply: FastifyReply) {
    if (!isMasterRole(request.user?.role)) {
      reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Master admin access required' } });
      return false;
    }
    return true;
  }

  app.get('/landing-featured', async (request, reply) => {
    if (!await requireMaster(request as AuthRequest, reply)) return;

    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';
    const settings = await getLandingFeaturedSettings(prisma);
    const [splat, splats] = await Promise.all([
      resolveLandingFeaturedSplat(prisma, settings),
      listFeaturedSplatOptions(prisma),
    ]);

    return {
      settings,
      splat: serializeFeaturedSplat(splat, assetBaseUrl),
      splats: splats.map((item) => serializeFeaturedSplat(item, assetBaseUrl)),
    };
  });

  app.patch('/landing-featured', async (request, reply) => {
    if (!await requireMaster(request as AuthRequest, reply)) return;

    const body = request.body as { mode?: unknown; selectedSplatId?: unknown };
    if (!isLandingFeaturedMode(body.mode)) {
      return reply.status(400).send({ error: { code: 'INVALID_MODE', message: 'Choose manual, latest, or random' } });
    }

    const selectedSplatId = typeof body.selectedSplatId === 'string' && body.selectedSplatId ? body.selectedSplatId : null;
    if (body.mode === 'manual') {
      if (!selectedSplatId) {
        return reply.status(400).send({ error: { code: 'SPLAT_REQUIRED', message: 'Select a published splat' } });
      }

      const exists = await prisma.splat.count({
        where: { id: selectedSplatId, status: 'PUBLISHED' },
      });
      if (!exists) {
        return reply.status(400).send({ error: { code: 'INVALID_SPLAT', message: 'Selected splat is not published' } });
      }
    }

    const settings = await saveLandingFeaturedSettings(prisma, {
      mode: body.mode,
      selectedSplatId: body.mode === 'manual' ? selectedSplatId : null,
    });
    const assetBaseUrl = process.env.ASSET_PUBLIC_URL || '/assets';
    const [splat, splats] = await Promise.all([
      resolveLandingFeaturedSplat(prisma, settings),
      listFeaturedSplatOptions(prisma),
    ]);

    return {
      settings,
      splat: serializeFeaturedSplat(splat, assetBaseUrl),
      splats: splats.map((item) => serializeFeaturedSplat(item, assetBaseUrl)),
    };
  });
}
