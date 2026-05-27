export type RendererMode = 'auto' | 'webgl2' | 'webgpu';
export type CameraMode = 'orbit' | 'fly' | 'locked';
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';
export type SplatAssetFormat = 'ply' | 'compressed-ply' | 'sog' | 'sog-meta' | 'lod-meta' | 'spz';
export type QualityProfileName = 'phoneUltraLow' | 'phoneLow' | 'phoneHigh' | 'desktopMedium' | 'desktopHigh' | 'vrQuest';
export type ViewerLoadPhase =
  | 'idle'
  | 'loading-metadata'
  | 'loading-asset'
  | 'renderable'
  | 'refining'
  | 'complete'
  | 'error';

export interface ViewerManifest {
  id: string;
  slug: string;
  title: string;
assets: {
    format: SplatAssetFormat;
    sceneUrl: string;
    lodManifestUrl?: string;
    metaUrl?: string;
    posterUrl?: string;
  };
  viewer: {
    defaultCamera?: unknown;
    enableVr: boolean;
    enableWebGpu: boolean;
    lockScene?: boolean;
    quality: QualityPreset;
    budgets: {
      desktop: number;
      mobile: number;
      vr: number;
    };
    pretransform?: {
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
    } | null;
  };
}

export interface MarkerPoint {
  id: string;
  title: string;
  body?: string;
  kind: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  icon?: string;
  color?: string;
}

/** @deprecated Use MarkerPoint. */
export type AnnotationPoint = MarkerPoint;

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  manifest: ViewerManifest;
  markers?: MarkerPoint[];
  /** @deprecated Use markers. */
  annotations?: MarkerPoint[];
  rendererMode?: RendererMode;
  cameraMode?: CameraMode;
  quality?: QualityPreset;
  locked?: boolean;
  showMarkers?: boolean;
  budgetOverride?: number;
  disablePostFx?: boolean;
  onMarkerSelect?: (marker: MarkerPoint) => void;
  onProgress?: (progress: ViewerRuntimeProgress) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onStats?: (stats: ViewerStats) => void;
}

export interface ViewerStats {
  fps: number;
  rendererMode: 'webgl2' | 'webgpu';
  gsplatRenderer?: string;
  rendererBackend?: 'playcanvas' | 'legacy-three';
  quality: QualityPreset;
  splatBudget: number;
  approximateLoadedSplats?: number;
  totalSplats?: number;
  activeSplats?: number;
  actualRenderedSplats?: number;
  sortTimeMs?: number;
  canvasPixels?: number;
  frameTimeMs?: number;
  devicePixelRatio?: number;
  minPixelSize?: number;
  minContribution?: number;
  alphaClip?: number;
  lodBaseDistance?: number;
  lodMultiplier?: number;
  lodRange?: [number, number];
  adaptiveQualityScale?: number;
  renderOnDemand?: boolean;
  loadPhase?: ViewerLoadPhase;
  lodActive?: boolean;
  assetFormat?: SplatAssetFormat;
  assetUrl?: string;
  isSog?: boolean;
}

export interface ViewerRuntimeProgress {
  phase: ViewerLoadPhase;
  message?: string;
  loadedBytes?: number;
  totalBytes?: number;
  assetUrl?: string;
  assetFormat?: SplatAssetFormat;
}

export interface ResolvedViewerAsset {
  format: SplatAssetFormat;
  url: string;
  source: 'scene' | 'meta' | 'lod';
  isLod: boolean;
  isSog: boolean;
}

export interface ViewerRuntime {
  start(): Promise<void>;
  destroy(): void;
  setQuality(quality: QualityPreset): void;
  setCameraMode(mode: CameraMode): void;
  setMarkers(points: MarkerPoint[]): void;
  /** @deprecated Use setMarkers. */
  setAnnotations(points: MarkerPoint[]): void;
  enterVr(): Promise<void>;
  exitVr(): Promise<void>;
}

export interface QualityProfile {
  splatBudget: number;
  maxDevicePixelRatio: number;
  maxPixelDim: number;
  enablePostFx: boolean;
  markerDistanceLimit: number;
  antialias: boolean;
  targetFps: number;
  adaptiveQualityEnabled: boolean;
  minPixelSize: number;
  minContribution: number;
  alphaClip: number;
  lodBaseDistanceScale: number;
  lodMultiplier: number;
  lodRange: [number, number];
  highQualitySH: boolean;
  renderOnDemand: boolean;
  preferredRenderer: RendererMode;
}

export const qualityProfiles: Record<QualityProfileName, QualityProfile> = {
  phoneUltraLow: {
    splatBudget: 40_000,
    maxDevicePixelRatio: 0.6,
    maxPixelDim: 720,
    enablePostFx: false,
    markerDistanceLimit: 10,
    antialias: false,
    targetFps: 30,
    adaptiveQualityEnabled: true,
    minPixelSize: 4,
    minContribution: 12,
    alphaClip: 1 / 48,
    lodBaseDistanceScale: 0.12,
    lodMultiplier: 2.25,
    lodRange: [3, 3],
    highQualitySH: false,
    renderOnDemand: true,
    preferredRenderer: 'webgl2',
  },
  phoneLow: {
    splatBudget: 75_000,
    maxDevicePixelRatio: 0.75,
    maxPixelDim: 900,
    enablePostFx: false,
    markerDistanceLimit: 20,
    antialias: false,
    targetFps: 30,
    adaptiveQualityEnabled: true,
    minPixelSize: 3.25,
    minContribution: 8,
    alphaClip: 1 / 64,
    lodBaseDistanceScale: 0.15,
    lodMultiplier: 2.5,
    lodRange: [2, 3],
    highQualitySH: false,
    renderOnDemand: true,
    preferredRenderer: 'webgl2',
  },
  phoneHigh: {
    splatBudget: 250_000,
    maxDevicePixelRatio: 1,
    maxPixelDim: 1080,
    enablePostFx: false,
    markerDistanceLimit: 30,
    antialias: false,
    targetFps: 45,
    adaptiveQualityEnabled: true,
    minPixelSize: 2,
    minContribution: 4,
    alphaClip: 1 / 255,
    lodBaseDistanceScale: 0.3,
    lodMultiplier: 3,
    lodRange: [1, 3],
    highQualitySH: false,
    renderOnDemand: true,
    preferredRenderer: 'auto',
  },
  desktopMedium: {
    splatBudget: 900_000,
    maxDevicePixelRatio: 1.5,
    maxPixelDim: 1440,
    enablePostFx: true,
    markerDistanceLimit: 60,
    antialias: false,
    targetFps: 60,
    adaptiveQualityEnabled: true,
    minPixelSize: 1.25,
    minContribution: 2,
    alphaClip: 1 / 255,
    lodBaseDistanceScale: 0.6,
    lodMultiplier: 3,
    lodRange: [0, 3],
    highQualitySH: true,
    renderOnDemand: true,
    preferredRenderer: 'webgl2',
  },
  desktopHigh: {
    splatBudget: 3_000_000,
    maxDevicePixelRatio: 2,
    maxPixelDim: 2160,
    enablePostFx: true,
    markerDistanceLimit: 100,
    antialias: true,
    targetFps: 60,
    adaptiveQualityEnabled: true,
    minPixelSize: 0.75,
    minContribution: 1,
    alphaClip: 1 / 255,
    lodBaseDistanceScale: 1,
    lodMultiplier: 3,
    lodRange: [0, 3],
    highQualitySH: true,
    renderOnDemand: true,
    preferredRenderer: 'webgl2',
  },
  vrQuest: {
    splatBudget: 120_000,
    maxDevicePixelRatio: 1,
    maxPixelDim: 1440,
    enablePostFx: false,
    markerDistanceLimit: 40,
    antialias: false,
    targetFps: 72,
    adaptiveQualityEnabled: true,
    minPixelSize: 3,
    minContribution: 8,
    alphaClip: 1 / 64,
    lodBaseDistanceScale: 0.15,
    lodMultiplier: 2.5,
    lodRange: [2, 3],
    highQualitySH: false,
    renderOnDemand: false,
    preferredRenderer: 'webgl2',
  },
};

export function chooseRendererMode(input: {
  requested: 'auto' | 'webgl2' | 'webgpu';
  isVrActive?: boolean;
  webgpuSupported: boolean;
  preferred?: 'auto' | 'webgl2' | 'webgpu';
}): 'webgl2' | 'webgpu' {
  if (input.isVrActive) {
    return 'webgl2';
  }

  const desired = input.requested === 'auto' ? (input.preferred ?? 'auto') : input.requested;
  if (desired === 'webgpu' && input.webgpuSupported) {
    return 'webgpu';
  }

  // Prefer WebGL2 by default because it is more visually stable across devices
  // and avoids WebGPU rendering artifacts that are still being resolved
  // upstream in the PlayCanvas GSplat pipeline.
  return 'webgl2';
}

export function detectDeviceProfile(): QualityProfileName {
  if (typeof navigator === 'undefined') return 'desktopMedium';

  const ua = navigator.userAgent || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  if (isMobile) {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const mem = nav.deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (mem < 2 || cores < 2) return 'phoneUltraLow';
    if (mem >= 4 || cores >= 6) return 'phoneHigh';
    return 'phoneLow';
  }

  return 'desktopMedium';
}

export function resolveViewerAsset(manifest: ViewerManifest): ResolvedViewerAsset {
  const format = manifest.assets.format || 'ply';

  if (manifest.assets.lodManifestUrl) {
    return {
      format: 'lod-meta',
      url: manifest.assets.lodManifestUrl,
      source: 'lod',
      isLod: true,
      isSog: true,
    };
  }

  if (format === 'sog-meta' && manifest.assets.metaUrl) {
    return {
      format,
      url: manifest.assets.metaUrl,
      source: 'meta',
      isLod: false,
      isSog: true,
    };
  }

  return {
    format,
    url: manifest.assets.sceneUrl,
    source: 'scene',
    isLod: false,
    isSog: format === 'sog' || format === 'sog-meta',
  };
}
