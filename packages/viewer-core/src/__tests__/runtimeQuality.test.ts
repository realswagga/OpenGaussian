import { describe, expect, it } from 'vitest';
import { PlayCanvasGsplatRuntime } from '../PlayCanvasGsplatRuntime.js';
import type { ViewerManifest, ViewerOptions } from '../types.js';

function createRuntime(options: Partial<ViewerOptions> = {}) {
  const manifest: ViewerManifest = {
    id: 'test-id',
    slug: 'test-slug',
    title: 'Test Scene',
    assets: {
      format: 'lod-meta',
      sceneUrl: '/scene.ply',
      lodManifestUrl: '/lod-meta.json',
    },
    viewer: {
      enableVr: true,
      enableWebGpu: true,
      quality: 'auto',
      budgets: { desktop: 900_000, mobile: 250_000, vr: 120_000 },
    },
  };

  return new PlayCanvasGsplatRuntime({
    canvas: {} as HTMLCanvasElement,
    manifest,
    ...options,
  });
}

function applyQuality(quality: ViewerOptions['quality'], options: Partial<ViewerOptions> = {}) {
  const runtime = createRuntime({ quality, ...options }) as unknown as {
    rendererMode: 'webgl2' | 'webgpu';
    sceneRadius: number;
    app: { scene: { gsplat: Record<string, unknown> } };
    splatEntity: { gsplat: Record<string, unknown> };
    applyGsplatSettings: () => void;
  };
  const gsplat: Record<string, unknown> = {};
  const component: Record<string, unknown> = {};

  runtime.rendererMode = 'webgpu';
  runtime.sceneRadius = 10;
  runtime.app = { scene: { gsplat } };
  runtime.splatEntity = { gsplat: component };
  runtime.applyGsplatSettings();

  return { gsplat, component };
}

describe('PlayCanvasGsplatRuntime quality application', () => {
  it('applies low quality to real scene.gsplat knobs', () => {
    const { gsplat, component } = applyQuality('low');

    expect(gsplat.splatBudget).toBe(75_000);
    expect(gsplat.minPixelSize).toBe(3.25);
    expect(gsplat.minContribution).toBe(8);
    expect(gsplat.alphaClip).toBeCloseTo(1 / 64);
    expect(gsplat.lodRangeMin).toBe(2);
    expect(gsplat.lodRangeMax).toBe(3);
    expect(component.lodBaseDistance).toBe(1.5);
    expect(component.lodMultiplier).toBe(2.5);
    expect(component.highQualitySH).toBe(false);
  });

  it('applies ultra quality to real scene.gsplat knobs', () => {
    const { gsplat, component } = applyQuality('ultra');

    expect(gsplat.splatBudget).toBe(3_000_000);
    expect(gsplat.minPixelSize).toBe(0.75);
    expect(gsplat.minContribution).toBe(1);
    expect(gsplat.alphaClip).toBeCloseTo(1 / 255);
    expect(gsplat.lodRangeMin).toBe(0);
    expect(gsplat.lodRangeMax).toBe(3);
    expect(component.lodBaseDistance).toBe(10);
    expect(component.lodMultiplier).toBe(3);
    expect(component.highQualitySH).toBe(true);
  });

  it('applies nofx by disabling expensive quality extras', () => {
    const { gsplat, component } = applyQuality('ultra', { disablePostFx: true });

    expect(gsplat.antiAlias).toBe(false);
    expect(component.highQualitySH).toBe(false);
  });
});
