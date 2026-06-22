// ============================================================
// Enums
// ============================================================

export type UserRole = 'MASTER_ADMIN' | 'CLIENT' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export type OrganizationRole = 'MANAGER' | 'EDITOR';

export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';

export type SplatStatus = 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';

export type ProcessingStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED';

export type CameraMode = 'orbit' | 'fly' | 'locked';

export type RendererMode = 'auto' | 'webgl2' | 'webgpu';

export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';

export type SplatAssetFormat = 'ply' | 'compressed-ply' | 'sog' | 'sog-meta' | 'lod-meta' | 'spz';

export type QualityProfileName = 'phoneUltraLow' | 'phoneLow' | 'phoneHigh' | 'desktopMedium' | 'desktopHigh' | 'vrQuest' | 'vrQuestHigh';

export type AssetVariantName = 'desktop' | 'mobile' | 'vr';

export type AssetVariantSelection = 'auto' | AssetVariantName;

export type XrQuality = 'performance' | 'balanced' | 'quality';

export type WebgpuPipelineMode = 'auto' | 'raster-cpu-sort' | 'raster-gpu-sort' | 'compute-lab' | 'off' | 'compute-canary';

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
  servingVersionId?: string | null;
  versionCount?: number;
  organization?: OrganizationSummary | null;
  organizationId?: string | null;
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
  organization?: OrganizationSummary | null;
  splatCount: number | null;
  publishedAt: string | null;
}

export interface TransferArchiveSummary {
  id: string;
  createdAt: string;
  totalRows: number;
  objectCount: number;
  objectBytes: number;
  schema: string;
  path: string;
}

export interface TransferJobProgress {
  id: string;
  operation: 'export' | 'upload' | 'validate' | 'import';
  status: 'pending' | 'running' | 'completed' | 'failed';
  phase: string;
  objectsDone: number;
  objectsTotal: number;
  bytesDone: number;
  bytesTotal: number;
  message?: string;
  error?: string;
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  websiteUrl?: string | null;
  previewUrl?: string | null;
  previewKey?: string | null;
  splatCount?: number;
  publishedSplatCount?: number;
  createdAt?: string;
}

export interface DefaultCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface SplatDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  servingVersionId?: string | null;
  posterKey?: string | null;
  productionFormat?: string | null;
  productionObjectKey?: string | null;
  lodManifestKey?: string | null;
  pretransformJson?: PretransformData | null;
  sourceFormat: string | null;
  splatCount: number | null;
  sizeBytes: number | null;
  boundingBoxJson: unknown;
  defaultCameraJson: DefaultCamera | null;
  globalSettingsJson: unknown;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

// ============================================================
// Viewer types
// ============================================================

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
  version?: {
    id: string;
    number: number;
  };
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

export interface AdminSplatVersion {
  id: string;
  splatId?: string;
  version: number;
  sourceKey: string;
  convertedKey?: string | null;
  lodKey?: string | null;
  posterKey?: string | null;
  productionFormat?: string | null;
  splatCount?: number | null;
  sizeBytes?: number | null;
  settingsKey?: string | null;
  processingStatus: ProcessingStatus | string;
  processingLog?: string | null;
  metrics?: unknown;
  markerCount?: number;
  isServed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VersionEditorMarker {
  id: string;
  title: string;
  body?: string | null;
  kind: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  icon?: string | null;
  color?: string | null;
  splatId: string;
  versionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionEditorState {
  splat: SplatDetail;
  version: AdminSplatVersion;
  markers: VersionEditorMarker[];
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

// ============================================================
// Widget types
// ============================================================

export interface WidgetConfig {
  scene: {
    slug: string;
    title?: string;
    description?: string | null;
    version?: {
      id: string;
      number: number;
    } | null;
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
  name?: string | null;
  memberships?: AuthMembership[];
  capabilities?: AuthCapabilities;
}

export interface AuthMembership {
  id: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: OrganizationRole;
  status: MembershipStatus;
  permissions: EditorPermissions;
}

export interface AuthCapabilities {
  isMasterAdmin: boolean;
  canAccessAdmin: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface EditorPermissions {
  canCreateSplats: boolean;
  canUploadSplats: boolean;
  canEditSplats: boolean;
  canDeleteSplats: boolean;
  canPublishSplats: boolean;
  canEditMarkers: boolean;
}

export interface AdminOrganization extends OrganizationSummary {
  isPublic: boolean;
  memberCount: number;
  splatCount: number;
  publishedSplatCount: number;
  currentUserRole?: OrganizationRole | 'MASTER_ADMIN';
}

export interface AdminMembership {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  status: MembershipStatus;
  permissions: EditorPermissions;
  createdAt: string;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: OrganizationRole;
    status: MembershipStatus;
  }>;
  createdAt: string;
}

export interface SearchResponse {
  query: string;
  splats: SplatListItem[];
  organizations: OrganizationSummary[];
}

export type LandingFeaturedMode = 'manual' | 'latest' | 'random';

export interface LandingFeaturedSettings {
  mode: LandingFeaturedMode;
  selectedSplatId: string | null;
}

export interface LandingFeaturedResponse {
  settings: LandingFeaturedSettings;
  splat: SplatListItem | null;
}

export interface AdminLandingFeaturedResponse extends LandingFeaturedResponse {
  splats: SplatListItem[];
}

// ============================================================
// Quality profiles
// ============================================================

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
