export type RendererMode = 'auto' | 'webgl2' | 'webgpu';
export type CameraMode = 'orbit' | 'fly' | 'locked';
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';
export type SplatAssetFormat = 'ply' | 'compressed-ply' | 'sog' | 'sog-meta' | 'lod-meta' | 'spz';
export type QualityProfileName = 'phoneUltraLow' | 'phoneLow' | 'phoneHigh' | 'desktopMedium' | 'desktopHigh' | 'vrQuest' | 'vrQuestHigh';
export type AssetVariantName = 'desktop' | 'mobile' | 'vr';
export type AssetVariantSelection = 'auto' | AssetVariantName;
export type XrQuality = 'performance' | 'balanced' | 'quality';
export type WebgpuPipelineMode =
  | 'auto'
  | 'raster-cpu-sort'
  | 'raster-gpu-sort'
  | 'compute-lab'
  /** @deprecated Use raster-cpu-sort. */
  | 'off'
  /** @deprecated Use compute-lab. */
  | 'compute-canary';
export type ViewerLoadPhase =
  | 'idle'
  | 'loading-metadata'
  | 'loading-asset'
  | 'renderable'
  | 'refining'
  | 'complete'
  | 'error';

export interface DefaultCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface ViewerAssetVariant {
  format: SplatAssetFormat;
  sceneUrl?: string;
  lodManifestUrl?: string;
  metaUrl?: string;
  posterUrl?: string;
}

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
    variants?: Partial<Record<AssetVariantName, ViewerAssetVariant>>;
  };
  viewer: {
    defaultCamera?: DefaultCamera;
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

export interface ViewerQuestPerfCpuBuckets {
  totalUpdateMs?: number;
  adaptiveQualityMs?: number;
  renderPolicyMs?: number;
  cameraInputMs?: number;
  vrLocomotionMs?: number;
  markerGizmoMs?: number;
  statsEmitMs?: number;
}

export interface ViewerQuestPerfQualityFlags {
  antialias: boolean;
  highQualitySH: boolean;
  radialSorting: boolean;
  renderOnDemand: boolean;
  markersVisible: boolean;
}

export interface ViewerQuestPerfRuntimeOverrides {
  splatBudget?: number;
  xrFramebufferScale?: number;
  xrFixedFoveation?: number;
  highQualitySH?: boolean;
  minPixelSize?: number;
  minContribution?: number;
  radialSorting?: boolean;
  markersVisible?: boolean;
}

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  manifest: ViewerManifest;
  markers?: MarkerPoint[];
  /** @deprecated Use markers. */
  annotations?: MarkerPoint[];
  rendererMode?: RendererMode;
  cameraMode?: CameraMode;
  quality?: QualityPreset;
  assetVariant?: AssetVariantSelection;
  xrQuality?: XrQuality;
  xrFramebufferScale?: number;
  xrFixedFoveation?: number;
  webgpuPipeline?: WebgpuPipelineMode;
  locked?: boolean;
  showMarkers?: boolean;
  budgetOverride?: number;
  disablePostFx?: boolean;
  questPerfEnabled?: boolean;
  backgroundColor?: [number, number, number];
  onMarkerSelect?: (marker: MarkerPoint) => void;
  onProgress?: (progress: ViewerRuntimeProgress) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onStats?: (stats: ViewerStats) => void;
  onQuestPerfSample?: (stats: ViewerStats) => void;
  onVrSessionChange?: (active: boolean) => void;
  onCameraModeChange?: (mode: CameraMode) => void;
}

export interface ViewerStats {
  fps: number;
  rendererMode: 'webgl2' | 'webgpu';
  gsplatRenderer?: string;
  rendererBackend?: 'playcanvas' | 'legacy-three';
  rendererPipeline?: WebgpuPipelineMode;
  rendererFallbackReason?: string;
  deviceProfile?: QualityProfileName;
  quality: QualityPreset;
  splatBudget: number;
  approximateLoadedSplats?: number;
  totalSplats?: number;
  activeSplats?: number;
  actualRenderedSplats?: number;
  sortTimeMs?: number;
  frameP50Ms?: number;
  frameP95Ms?: number;
  frameP99Ms?: number;
  cpu?: ViewerQuestPerfCpuBuckets;
  gpuTimeMs?: number;
  gpuTimerStatus?: 'disabled' | 'unsupported' | 'pending' | 'available' | 'disjoint' | 'n/a';
  canvasPixels?: number;
  frameTimeMs?: number;
  devicePixelRatio?: number;
  jsHeapUsedMB?: number;
  jsHeapTotalMB?: number;
  minPixelSize?: number;
  minContribution?: number;
  alphaClip?: number;
  lodBaseDistance?: number;
  lodMultiplier?: number;
  lodRange?: [number, number];
  adaptiveQualityScale?: number;
  renderOnDemand?: boolean;
  renderIdle?: boolean;
  loadPhase?: ViewerLoadPhase;
  lodActive?: boolean;
  assetFormat?: SplatAssetFormat;
  assetUrl?: string;
  activeAssetVariant?: AssetVariantName | 'base';
  isSog?: boolean;
  xrActive?: boolean;
  xrFrameRate?: number;
  xrFramebufferScale?: number;
  fixedFoveation?: number | null;
  lodLoadingCount?: number;
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
  };
  qualityFlags?: ViewerQuestPerfQualityFlags;
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
  variantName: AssetVariantName | 'base';
}

export interface ViewerRuntime {
  start(): Promise<void>;
  destroy(): void;
  setQuality(quality: QualityPreset): void;
  setCameraMode(mode: CameraMode): void;
  setBackgroundColor(color: [number, number, number]): void;
  setMarkers(points: MarkerPoint[]): void;
  /** @deprecated Use setMarkers. */
  setAnnotations(points: MarkerPoint[]): void;
  setQuestPerfEnabled(enabled: boolean): void;
  setQuestPerfOverrides(overrides: ViewerQuestPerfRuntimeOverrides): void;
  captureFrame(options?: { type?: string; quality?: number }): Promise<Blob>;
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
  xrFramebufferScale?: number;
  xrFixedFoveation?: number;
  radialSorting?: boolean;
  nearClip?: number;
  maxPixelRadius?: number;
  targetActiveSplats?: number;
  lodUpdateAngle?: number;
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
    preferredRenderer: 'webgpu',
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
    preferredRenderer: 'webgpu',
  },
  vrQuest: {
    splatBudget: 60_000,
    maxDevicePixelRatio: 0.75,
    maxPixelDim: 1024,
    enablePostFx: false,
    markerDistanceLimit: 40,
    antialias: false,
    targetFps: 72,
    adaptiveQualityEnabled: true,
    minPixelSize: 5,
    minContribution: 14,
    alphaClip: 1 / 32,
    lodBaseDistanceScale: 0.15,
    lodMultiplier: 2.75,
    lodRange: [3, 3],
    highQualitySH: false,
    renderOnDemand: false,
    preferredRenderer: 'webgl2',
    xrFramebufferScale: 0.6,
    xrFixedFoveation: 1,
    radialSorting: true,
    nearClip: 0.08,
    targetActiveSplats: 60_000,
    lodUpdateAngle: 90,
  },
  vrQuestHigh: {
    splatBudget: 600_000,
    maxDevicePixelRatio: 1.25,
    maxPixelDim: 1800,
    enablePostFx: true,
    markerDistanceLimit: 60,
    antialias: true,
    targetFps: 72,
    adaptiveQualityEnabled: false,
    minPixelSize: 0.625,
    minContribution: 1,
    alphaClip: 1 / 510,
    lodBaseDistanceScale: 1.2,
    lodMultiplier: 3.25,
    lodRange: [0, 3],
    highQualitySH: true,
    renderOnDemand: false,
    preferredRenderer: 'webgl2',
    xrFramebufferScale: 0.9,
    xrFixedFoveation: 0.35,
    radialSorting: true,
    nearClip: 0.04,
    targetActiveSplats: 600_000,
    lodUpdateAngle: 15,
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

  if (desired === 'auto' && input.webgpuSupported) {
    return 'webgpu';
  }

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

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
}

export function resolveAssetVariantName(
  selection: AssetVariantSelection = 'auto',
  isVrActive = false,
): AssetVariantName {
  if (selection !== 'auto') return selection;
  if (isVrActive) return 'vr';
  return isMobileUserAgent() ? 'mobile' : 'desktop';
}

function resolveAssetFields(manifest: ViewerManifest, variantName: AssetVariantName): ViewerAssetVariant & { variantName: AssetVariantName | 'base' } {
  const variant = manifest.assets.variants?.[variantName];
  const hasVariantUrl = Boolean(variant?.lodManifestUrl || variant?.metaUrl || variant?.sceneUrl);
  if (!variant || !hasVariantUrl) {
    return { ...manifest.assets, variantName: 'base' };
  }
  return {
    ...manifest.assets,
    ...variant,
    format: variant.format || manifest.assets.format || 'ply',
    variantName,
  };
}

export function resolveViewerAsset(
  manifest: ViewerManifest,
  selection: AssetVariantSelection = 'auto',
  isVrActive = false,
): ResolvedViewerAsset {
  const preferredVariant = resolveAssetVariantName(selection, isVrActive);
  const asset = resolveAssetFields(manifest, preferredVariant);
  const format = asset.format || 'ply';

  if (asset.lodManifestUrl) {
    return {
      format: 'lod-meta',
      url: asset.lodManifestUrl,
      source: 'lod',
      isLod: true,
      isSog: true,
      variantName: asset.variantName,
    };
  }

  if (format === 'sog-meta' && asset.metaUrl) {
    return {
      format,
      url: asset.metaUrl,
      source: 'meta',
      isLod: false,
      isSog: true,
      variantName: asset.variantName,
    };
  }

  return {
    format,
    url: asset.sceneUrl || manifest.assets.sceneUrl,
    source: 'scene',
    isLod: false,
    isSog: format === 'sog' || format === 'sog-meta',
    variantName: asset.variantName,
  };
}
