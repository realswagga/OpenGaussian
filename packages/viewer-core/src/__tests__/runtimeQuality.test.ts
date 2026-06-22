import { describe, expect, it } from 'vitest';
import { Entity, GraphNode, GSPLAT_RENDERER_RASTER_CPU_SORT, GSPLAT_RENDERER_RASTER_GPU_SORT } from 'playcanvas';
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
      budgets: { desktop: 900_000, mobile: 250_000, vr: 60_000 },
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

  it('applies high quality to real scene.gsplat knobs', () => {
    const { gsplat, component } = applyQuality('high');

    expect(gsplat.splatBudget).toBe(900_000);
    expect(gsplat.minPixelSize).toBe(1.25);
    expect(gsplat.minContribution).toBe(2);
    expect(gsplat.alphaClip).toBeCloseTo(1 / 255);
    expect(gsplat.lodRangeMin).toBe(0);
    expect(gsplat.lodRangeMax).toBe(3);
    expect(component.lodBaseDistance).toBe(6);
    expect(component.lodMultiplier).toBe(3);
    expect(component.highQualitySH).toBe(true);
    expect(gsplat.renderer).toBe(GSPLAT_RENDERER_RASTER_GPU_SORT);
  });

  it('keeps the CPU sorter as an explicit WebGPU kill switch', () => {
    const { gsplat } = applyQuality('high', { webgpuPipeline: 'raster-cpu-sort' });
    expect(gsplat.renderer).toBe(GSPLAT_RENDERER_RASTER_CPU_SORT);
  });

  it('enforces manifest budgets over runtime overrides', () => {
    const { gsplat } = applyQuality('high', { budgetOverride: 3_000_000 });
    expect(gsplat.splatBudget).toBe(900_000);
  });

  it('applies nofx by disabling expensive quality extras', () => {
    const { gsplat, component } = applyQuality('high', { disablePostFx: true });

    expect(gsplat.antiAlias).toBe(false);
    expect(component.highQualitySH).toBe(false);
  });

  it('applies aggressive VR profile values for VR asset sessions', () => {
    const { gsplat, component } = applyQuality('auto', { assetVariant: 'vr' });

    expect(gsplat.splatBudget).toBe(60_000);
    expect(gsplat.minPixelSize).toBe(5);
    expect(gsplat.minContribution).toBe(14);
    expect(gsplat.alphaClip).toBeCloseTo(1 / 32);
    expect(gsplat.lodRangeMin).toBe(3);
    expect(gsplat.lodRangeMax).toBe(3);
    expect(gsplat.radialSorting).toBe(true);
    expect(gsplat.lodUpdateAngle).toBe(90);
    expect(component.highQualitySH).toBe(false);
  });

  it('applies the opt-in high-detail VR profile without the conservative VR cap', () => {
    const { gsplat, component } = applyQuality('high', { assetVariant: 'vr' });

    expect(gsplat.splatBudget).toBe(600_000);
    expect(gsplat.minPixelSize).toBe(0.625);
    expect(gsplat.minContribution).toBe(1);
    expect(gsplat.alphaClip).toBeCloseTo(1 / 510);
    expect(gsplat.lodRangeMin).toBe(0);
    expect(gsplat.lodRangeMax).toBe(3);
    expect(gsplat.lodUpdateAngle).toBe(15);
    expect(component.lodBaseDistance).toBe(12);
    expect(component.lodMultiplier).toBe(3.25);
    expect(component.highQualitySH).toBe(true);
  });

  it('does not report a first splat frame until GSplat readiness is rendered', () => {
    const runtime = createRuntime() as unknown as {
      splatEntity: object | null;
      app: { stats: { frame: { gsplats: number } } } | null;
      gsplatFrameReady: boolean;
      firstFrameRendered: boolean;
      firstRenderableResolve: (() => void) | null;
      recordRenderedFrame: () => void;
    };
    let resolved = false;
    runtime.splatEntity = {};
    runtime.app = { stats: { frame: { gsplats: 0 } } };
    runtime.firstRenderableResolve = () => {
      resolved = true;
    };

    runtime.gsplatFrameReady = true;
    runtime.recordRenderedFrame();
    expect(runtime.firstFrameRendered).toBe(false);
    expect(resolved).toBe(false);

    runtime.app.stats.frame.gsplats = 1;
    runtime.recordRenderedFrame();
    expect(runtime.firstFrameRendered).toBe(true);
    expect(resolved).toBe(true);
  });

  it('forces an initial GSplat population pass without camera input', () => {
    const runtime = createRuntime() as unknown as {
      splatEntity: object | null;
      firstFrameRendered: boolean;
      app: {
        scene: { gsplat: { dirty?: boolean } };
        autoRender: boolean;
        renderNextFrame: boolean;
      } | null;
      forceInitialSplatPopulation: () => void;
    };
    runtime.splatEntity = {};
    runtime.app = {
      scene: { gsplat: {} },
      autoRender: false,
      renderNextFrame: false,
    };

    runtime.forceInitialSplatPopulation();

    expect(runtime.app.scene.gsplat.dirty).toBe(true);
    expect(runtime.app.autoRender).toBe(true);
    expect(runtime.app.renderNextFrame).toBe(true);
  });

  it('keeps High VR at full scale instead of adaptively degrading it', () => {
    const runtime = createRuntime({ quality: 'high', assetVariant: 'vr' }) as unknown as {
      adaptiveQualityScale: number;
      updateAdaptiveQuality: (now: number) => void;
    };
    runtime.adaptiveQualityScale = 0.35;

    runtime.updateAdaptiveQuality(performance.now());

    expect(runtime.adaptiveQualityScale).toBe(1);
  });

  it('places the tracked VR head at the saved initial-camera position with horizontal-only rotation', () => {
    const runtime = createRuntime() as unknown as {
      manifest: ViewerManifest;
      cameraRoot: Entity | null;
      camera: Entity | null;
      pendingVrCameraAlignment: boolean;
      alignVrCameraToInitialPose: () => void;
    };
    runtime.manifest.viewer.defaultCamera = {
      position: [4, 2, 3],
      target: [5, 3, 3],
    };
    const root = new GraphNode('camera-root');
    const head = new GraphNode('camera');
    root.addChild(head);
    head.setLocalPosition(0.15, 1.65, -0.1);
    runtime.cameraRoot = root as unknown as Entity;
    runtime.camera = head as unknown as Entity;
    runtime.pendingVrCameraAlignment = true;

    runtime.alignVrCameraToInitialPose();

    const position = head.getPosition();
    expect(position.x).toBeCloseTo(4);
    expect(position.y).toBeCloseTo(2);
    expect(position.z).toBeCloseTo(3);
    // Pitch is flattened — forward should be horizontal (target x-pos = 1, z-pos = 0)
    expect(head.forward.x).toBeCloseTo(1);
    expect(head.forward.y).toBeCloseTo(0);
    expect(head.forward.z).toBeCloseTo(0);
    expect(runtime.pendingVrCameraAlignment).toBe(false);
  });

  it('binds and unbinds XR input lifecycle events explicitly', () => {
    const bound: string[] = [];
    const unbound: string[] = [];
    const input = {
      inputSources: [],
      on: (event: string) => bound.push(event),
      off: (event: string) => unbound.push(event),
    };
    const runtime = createRuntime() as unknown as {
      app: { xr: { input: typeof input } } | null;
      vrInputBound: boolean;
      bindVrInput: () => void;
      unbindVrInput: () => void;
    };
    runtime.app = { xr: { input } };

    runtime.bindVrInput();
    expect(bound).toEqual(['add', 'remove', 'selectstart']);
    expect(runtime.vrInputBound).toBe(true);

    runtime.unbindVrInput();
    expect(unbound).toEqual(['add', 'remove', 'selectstart']);
    expect(runtime.vrInputBound).toBe(false);
  });

  it('expands a VR marker while a controller ray is aiming at it', () => {
    const markerVisual = {
      targetExpansion: 0,
      emphasized: false,
      lastDrawnExpansion: 0,
    };
    const runtime = createRuntime() as unknown as {
      selectedMarkerId: string | null;
      vrMarkerVisuals: Map<string, typeof markerVisual>;
      updateVrMarkerHighlights: (hoveredMarkerIds: Set<string>) => void;
    };
    runtime.selectedMarkerId = null;
    runtime.vrMarkerVisuals = new Map([['marker-1', markerVisual]]);

    runtime.updateVrMarkerHighlights(new Set(['marker-1']));
    expect(markerVisual.targetExpansion).toBe(1);
    expect(markerVisual.emphasized).toBe(true);

    runtime.updateVrMarkerHighlights(new Set());
    expect(markerVisual.targetExpansion).toBe(0);
    expect(markerVisual.emphasized).toBe(false);
  });

  it('retains Quest input sources until XR explicitly removes them', () => {
    const source = { id: 7 };
    const runtime = createRuntime() as unknown as {
      app: { autoRender?: boolean; renderNextFrame?: boolean } | null;
      vrInputSources: Map<number, typeof source>;
      onVrInputSourceAdd: (inputSource: typeof source) => void;
      onVrInputSourceRemove: (inputSource: typeof source) => void;
    };
    runtime.app = {};

    runtime.onVrInputSourceAdd(source);
    expect(runtime.vrInputSources.get(7)).toBe(source);

    runtime.onVrInputSourceRemove(source);
    expect(runtime.vrInputSources.has(7)).toBe(false);
  });
});
