export type RendererMode = 'auto' | 'webgl2' | 'webgpu';
export type CameraMode = 'orbit' | 'fly' | 'locked';
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type SplatAssetFormat = 'ply' | 'compressed-ply' | 'sog' | 'sog-meta' | 'lod-meta' | 'spz';
export type QualityProfileName = 'phoneLow' | 'phoneHigh' | 'desktopMedium' | 'desktopHigh' | 'vrQuest';
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
  onMarkerSelect?: (marker: MarkerPoint) => void;
  onProgress?: (progress: ViewerRuntimeProgress) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onStats?: (stats: ViewerStats) => void;
}

export interface ViewerStats {
  fps: number;
  rendererMode: 'webgl2' | 'webgpu';
  rendererBackend?: 'playcanvas' | 'legacy-three';
  quality: QualityPreset;
  splatBudget: number;
  approximateLoadedSplats?: number;
  totalSplats?: number;
  activeSplats?: number;
  sortTimeMs?: number;
  canvasPixels?: number;
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
  enablePostFx: boolean;
  markerDistanceLimit: number;
  antialias: boolean;
}

export const qualityProfiles: Record<QualityProfileName, QualityProfile> = {
  phoneLow: {
    splatBudget: 400_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 20,
    antialias: false,
  },
  phoneHigh: {
    splatBudget: 800_000,
    maxDevicePixelRatio: 1.25,
    enablePostFx: false,
    markerDistanceLimit: 30,
    antialias: false,
  },
  desktopMedium: {
    splatBudget: 1_500_000,
    maxDevicePixelRatio: 1.5,
    enablePostFx: true,
    markerDistanceLimit: 60,
    antialias: false,
  },
  desktopHigh: {
    splatBudget: 3_000_000,
    maxDevicePixelRatio: 2,
    enablePostFx: true,
    markerDistanceLimit: 100,
    antialias: true,
  },
  vrQuest: {
    splatBudget: 700_000,
    maxDevicePixelRatio: 1,
    enablePostFx: false,
    markerDistanceLimit: 40,
    antialias: false,
  },
};

export function chooseRendererMode(input: {
  requested: 'auto' | 'webgl2' | 'webgpu';
  isVrRequested: boolean;
  webgpuSupported: boolean;
}): 'webgl2' | 'webgpu' {
  if (input.isVrRequested) {
    return 'webgl2';
  }

  if (input.requested === 'webgpu' && input.webgpuSupported) {
    return 'webgpu';
  }

  if (input.requested === 'auto' && input.webgpuSupported) {
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
    const isHighEnd = (nav.deviceMemory && nav.deviceMemory >= 4) ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency >= 6);
    return isHighEnd ? 'phoneHigh' : 'phoneLow';
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
