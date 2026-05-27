import { describe, expect, it } from 'vitest';
import { resolveViewerAsset, type ViewerManifest } from '../types.js';

function manifestWithAssets(assets: ViewerManifest['assets']): ViewerManifest {
  return {
    id: 'scene-1',
    slug: 'scene-1',
    title: 'Scene 1',
    assets,
    viewer: {
      enableVr: false,
      enableWebGpu: true,
      quality: 'auto',
      budgets: {
        desktop: 1_500_000,
        mobile: 300_000,
        vr: 200_000,
      },
    },
  };
}

describe('resolveViewerAsset', () => {
  it('uses sceneUrl for ordinary production assets', () => {
    const asset = resolveViewerAsset(manifestWithAssets({
      format: 'sog',
      sceneUrl: '/assets/scene.sog',
    }));

    expect(asset).toEqual({
      format: 'sog',
      url: '/assets/scene.sog',
      source: 'scene',
      isLod: false,
      isSog: true,
    });
  });

  it('prefers lodManifestUrl for normal viewing', () => {
    const asset = resolveViewerAsset(manifestWithAssets({
      format: 'sog',
      sceneUrl: '/assets/scene.sog',
      lodManifestUrl: '/assets/lod-meta.json',
    }));

    expect(asset.format).toBe('lod-meta');
    expect(asset.url).toBe('/assets/lod-meta.json');
    expect(asset.source).toBe('lod');
    expect(asset.isLod).toBe(true);
  });

  it('uses metaUrl for unbundled SOG metadata assets', () => {
    const asset = resolveViewerAsset(manifestWithAssets({
      format: 'sog-meta',
      sceneUrl: '/assets/scene.meta.json',
      metaUrl: '/assets/scene.meta.json',
    }));

    expect(asset.url).toBe('/assets/scene.meta.json');
    expect(asset.source).toBe('meta');
    expect(asset.isSog).toBe(true);
  });
});
