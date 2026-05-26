// ============================================================
// Enums
// ============================================================

export type UserRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export type SplatStatus = 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';

export type ProcessingStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED';

export type CameraMode = 'orbit' | 'fly' | 'walk' | 'locked';

export type RendererMode = 'auto' | 'webgl2' | 'webgpu';

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

// ============================================================
// API Response shapes
// ============================================================

export interface HealthResponse {
  ok: boolean;
  service: string;
  time: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total?: number;
}

// ============================================================
// Splat types
// ============================================================

export interface SplatSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  posterUrl: string | null;
  posterKey?: string | null;
  sourceFormat?: string | null;
  sizeBytes?: number | null;
  splatCount: number | null;
  status: string;
  publishedAt: string | null;
}

export interface SplatListItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  posterUrl: string | null;
  splatCount: number | null;
  publishedAt: string | null;
}

export interface SplatDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  sourceFormat: string | null;
  splatCount: number | null;
  sizeBytes: number | null;
  boundingBoxJson: unknown;
  defaultCameraJson: unknown;
  globalSettingsJson: unknown;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

// ============================================================
// Viewer types
// ============================================================

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

// ============================================================
// Widget types
// ============================================================

export interface WidgetConfig {
  scene: {
    slug: string;
    manifestUrl: string;
    markersUrl: string;
    /** @deprecated Use markersUrl. */
    annotationsUrl: string;
  };
  widget: {
    locked: boolean;
    showMarkers: boolean;
    showUi: boolean;
    enableVr: boolean;
    quality: QualityPreset;
  };
}

// ============================================================
// Auth types
// ============================================================

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// ============================================================
// Quality profiles
// ============================================================

export interface QualityProfile {
  splatBudget: number;
  maxDevicePixelRatio: number;
  enablePostFx: boolean;
  markerDistanceLimit: number;
  antialias: boolean;
}

// ============================================================
// Pretransform types
// ============================================================

export interface PretransformData {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

// ============================================================
// Admin dashboard stats
// ============================================================

export interface AdminDashboardStats {
  totalSplats: number;
  publishedSplats: number;
  draftSplats: number;
  processingSplats: number;
  failedSplats: number;
  readySplats: number;
  archivedSplats: number;
  totalAnnotations: number;
  activeJobs: number;
  storageBytesEstimate: number;
  recentJobs: AdminRecentJob[];
}

export interface AdminRecentJob {
  id: string;
  splatId: string;
  splatTitle: string;
  version: number;
  status: string;
  log: string | null;
  createdAt: string;
}
