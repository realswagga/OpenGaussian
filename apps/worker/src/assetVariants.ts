import type { AssetVariantName, SplatAssetFormat } from '@gsplat/shared';

export interface SplatVariantConfig {
  name: AssetVariantName;
  maxSplats: number;
  ratios: number[];
  harmonics: 0 | 1 | 2 | 3;
  iterations: number;
  lodChunkCountK: number;
  lodChunkExtent: number;
}

export interface WorkerAssetVariantMetadata {
  format: SplatAssetFormat;
  lodManifestKey: string;
  targetSplats: number[];
  generatedAt: string;
}

export const SPLAT_VARIANT_CONFIGS: Record<AssetVariantName, SplatVariantConfig> = {
  desktop: {
    name: 'desktop',
    maxSplats: 900_000,
    ratios: [1, 0.5, 0.25, 0.125],
    harmonics: 2,
    iterations: 8,
    lodChunkCountK: 512,
    lodChunkExtent: 16,
  },
  mobile: {
    name: 'mobile',
    maxSplats: 250_000,
    ratios: [1, 0.45, 0.2, 0.08],
    harmonics: 0,
    iterations: 6,
    lodChunkCountK: 256,
    lodChunkExtent: 10,
  },
  vr: {
    name: 'vr',
    // Keep enough detail in the streamed VR asset for the opt-in High
    // profile. Conservative VR profiles still constrain their active budget
    // and LOD range at runtime.
    maxSplats: 600_000,
    // Level 3 remains at the conservative 60k runtime budget, while High can
    // refine through the denser levels up to 600k.
    ratios: [1, 0.5, 0.25, 0.1],
    harmonics: 0,
    iterations: 4,
    lodChunkCountK: 128,
    lodChunkExtent: 6,
  },
};

export function computeVariantTargets(totalSplats: number, config: SplatVariantConfig): number[] {
  if (!Number.isFinite(totalSplats) || totalSplats <= 0) return [];

  const head = Math.max(1, Math.min(Math.round(totalSplats), config.maxSplats));
  const unique = new Set<number>();
  for (const ratio of config.ratios) {
    const target = Math.max(1, Math.min(head, Math.round(head * ratio)));
    unique.add(target);
  }

  return [...unique].sort((a, b) => b - a);
}
