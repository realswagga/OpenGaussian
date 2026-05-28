import { describe, expect, it } from 'vitest';
import { resolveAssetVariantName, resolveViewerAsset, type ViewerManifest } from '../types.js';

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
      variantName: 'base',
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
    expect(asset.variantName).toBe('base');
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
    expect(asset.variantName).toBe('base');
  });

  it('selects the explicit VR LOD asset variant', () => {
    const asset = resolveViewerAsset(manifestWithAssets({
      format: 'sog',
      sceneUrl: '/assets/scene.sog',
      variants: {
        vr: {
          format: 'lod-meta',
          lodManifestUrl: '/assets/vr/lod-meta.json',
        },
      },
    }), 'vr');

    expect(asset).toMatchObject({
      format: 'lod-meta',
      url: '/assets/vr/lod-meta.json',
      source: 'lod',
      isLod: true,
      variantName: 'vr',
    });
  });

  it('falls back to the base asset when a selected variant has no URL', () => {
    const asset = resolveViewerAsset(manifestWithAssets({
      format: 'sog',
      sceneUrl: '/assets/scene.sog',
      variants: {
        vr: {
          format: 'lod-meta',
        },
      },
    }), 'vr');

    expect(asset.url).toBe('/assets/scene.sog');
    expect(asset.variantName).toBe('base');
  });

  it('prefers the VR variant during active XR in auto mode', () => {
    expect(resolveAssetVariantName('auto', true)).toBe('vr');
  });
});
