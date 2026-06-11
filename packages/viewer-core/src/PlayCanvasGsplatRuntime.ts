import {
  AppBase,
  AppOptions,
  Asset,
  BinaryHandler,
  CameraComponentSystem,
  Color,
  ContainerHandler,
  createGraphicsDevice,
  Entity,
  GSplatComponentSystem,
  GSplatHandler,
  GSPLAT_DEBUG_NONE,
  GSPLAT_RENDERER_COMPUTE,
  GSPLAT_RENDERER_RASTER_CPU_SORT,
  Keyboard,
  LightComponentSystem,
  Mouse,
  Picker,
  RenderComponentSystem,
  ScriptComponentSystem,
  TextureHandler,
  TouchDevice,
  Vec3,
  XRSPACE_LOCALFLOOR,
  XRTYPE_VR,
  XrManager,
  type GraphicsDevice,
} from 'playcanvas';
import type {
  MarkerPoint,
  CameraMode,
  QualityPreset,
  ResolvedViewerAsset,
  ViewerLoadPhase,
  ViewerManifest,
  ViewerOptions,
  QualityProfile,
  ViewerRuntime,
  ViewerStats,
  ViewerQuestPerfCpuBuckets,
  ViewerQuestPerfQualityFlags,
  ViewerQuestPerfRuntimeOverrides,
  WebgpuPipelineMode,
  XrQuality,
} from './types.js';
import { chooseRendererMode, detectDeviceProfile, qualityProfiles, resolveViewerAsset } from './types.js';
import { computeQuestPerfPercentiles } from './questPerf.js';
import {
  applyDeadzone,
  center2D,
  classifyTwoPointerGesture,
  clamp,
  clampDollyStepToDepth,
  computeDepthAwareDollyStep,
  computeFrontDepthConsensus,
  computePinchScale,
  distance2D,
  normalizeWheelDeltaY,
  readGamepadStick,
} from './navigationControls.js';

type RendererBackend = 'webgl2' | 'webgpu';
type PointerGestureMode = 'none' | 'orbit' | 'pan';

interface TrackedPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  pointerType: string;
  button: number;
  moved: boolean;
}

interface TouchGestureState {
  distance: number;
  center: { x: number; y: number };
  depth: number;
}

interface VirtualJoystickState {
  pointerId: number | null;
  x: number;
  y: number;
}

interface RuntimeXrSessionLike {
  addEventListener(type: 'end', listener: () => void, options?: AddEventListenerOptions): void;
}

type RuntimeXrManagerLike = XrManager & {
  fixedFoveation?: number;
  frameRate?: number;
  updateTargetFrameRate?: (targetFrameRate: number, callback?: (error?: Error | null) => void) => void;
};

interface RuntimeXrInputSource {
  id?: number;
  handedness?: string;
  gamepad?: Gamepad | null;
  selecting?: boolean;
  getPosition?: () => Vec3 | null;
  getOrigin?: () => Vec3;
  getDirection?: () => Vec3;
}

interface VrScaleGestureState {
  leftId: number | undefined;
  rightId: number | undefined;
  initialDistance: number;
  initialMidpoint: Vec3;
  initialHeadPosition: Vec3;
  initialRootPosition: Vec3;
}

interface RuntimeAppOptions {
  graphicsDevice: GraphicsDevice;
  mouse: Mouse;
  touch: TouchDevice;
  keyboard: Keyboard;
}

interface EffectiveQualitySettings {
  splatBudget: number;
  maxDevicePixelRatio: number;
  maxPixelDim: number;
  minPixelSize: number;
  minContribution: number;
  alphaClip: number;
  lodBaseDistance: number;
  lodMultiplier: number;
  lodRange: [number, number];
  highQualitySH: boolean;
  renderOnDemand: boolean;
  antialias: boolean;
  radialSorting: boolean;
  nearClip: number;
  maxPixelRadius?: number;
  targetActiveSplats?: number;
  lodUpdateAngle: number;
}

interface GpuTimerState {
  gl: WebGL2RenderingContext;
  ext: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  };
  activeQuery: WebGLQuery | null;
  pendingQuery: WebGLQuery | null;
  lastTimeMs?: number;
  status: 'disabled' | 'unsupported' | 'pending' | 'available' | 'disjoint';
}

type DepthPickSource = 'scene' | 'target-plane' | 'fallback';

interface DepthPick {
  point: Vec3;
  distance: number;
  confidence: number;
  source: DepthPickSource;
}

interface CachedDepthPick {
  x: number;
  y: number;
  time: number;
  cameraPosition: Vec3;
  target: Vec3;
  pick: DepthPick;
}

interface OrbitAnchorTransition {
  from: Vec3;
  to: Vec3;
  cameraPosition: Vec3;
  startTime: number;
  durationMs: number;
}

const DEPTH_RAY_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [5, 0],
  [-5, 0],
  [0, 5],
  [0, -5],
  [4, 4],
  [-4, 4],
  [4, -4],
  [-4, -4],
];

class GsplatApp extends AppBase {
  constructor(canvas: HTMLCanvasElement, options: RuntimeAppOptions) {
    super(canvas);

    const appOptions = new AppOptions();
    appOptions.graphicsDevice = options.graphicsDevice;
    appOptions.componentSystems = [
      CameraComponentSystem,
      LightComponentSystem,
      RenderComponentSystem,
      GSplatComponentSystem,
      ScriptComponentSystem,
    ];
    appOptions.resourceHandlers = [
      ContainerHandler,
      TextureHandler,
      GSplatHandler,
      BinaryHandler,
    ];
    appOptions.mouse = options.mouse;
    appOptions.touch = options.touch;
    appOptions.keyboard = options.keyboard;
    appOptions.xr = XrManager;
    this.init(appOptions);
  }
}

function isWebGPUAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string): string {
  try {
    return new URL(url, window.location.href).pathname.split('/').pop() || 'scene';
  } catch {
    return url.split('/').pop() || 'scene';
  }
}

function qualityForPreset(quality: QualityPreset): QualityProfile {
  if (quality === 'low') return qualityProfiles.phoneLow;
  if (quality === 'medium') return qualityProfiles.phoneHigh;
  if (quality === 'high') return qualityProfiles.desktopMedium;
  return qualityProfiles[detectDeviceProfile()];
}

function readPossibleCount(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['numSplats', 'numSplat', 'splatCount', 'count', 'vertexCount']) {
    const n = record[key];
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  for (const key of ['resource', 'data', 'splatData', 'gsplat', 'lodResource']) {
    const nested = readPossibleCount(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function readAabbRadius(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  const aabb = record.aabb;
  if (aabb && typeof aabb === 'object') {
    const halfExtents = (aabb as Record<string, unknown>).halfExtents as
      | { x?: number; y?: number; z?: number; length?: () => number }
      | undefined;
    if (halfExtents) {
      if (typeof halfExtents.length === 'function') {
        const radius = halfExtents.length();
        if (Number.isFinite(radius) && radius > 0) return radius;
      }
      const x = halfExtents.x ?? 0;
      const y = halfExtents.y ?? 0;
      const z = halfExtents.z ?? 0;
      const radius = Math.sqrt(x * x + y * y + z * z);
      if (Number.isFinite(radius) && radius > 0) return radius;
    }
  }

  const bound = record.bound;
  if (bound && typeof bound === 'object') {
    const b = bound as { min?: number[]; max?: number[] };
    if (Array.isArray(b.min) && Array.isArray(b.max) && b.min.length >= 3 && b.max.length >= 3) {
      const radius = Math.sqrt(
        ((b.max[0]! - b.min[0]!) / 2) ** 2 +
        ((b.max[1]! - b.min[1]!) / 2) ** 2 +
        ((b.max[2]! - b.min[2]!) / 2) ** 2,
      );
      if (Number.isFinite(radius) && radius > 0) return radius;
    }
  }

  for (const key of ['resource', 'data', 'splatData', 'gsplat', 'lodResource', 'octree']) {
    const nested = readAabbRadius(record[key], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function readAabbCenter(value: unknown, depth = 0): Vec3 | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  const aabb = record.aabb;
  if (aabb && typeof aabb === 'object') {
    const center = (aabb as Record<string, unknown>).center as { x?: number; y?: number; z?: number } | undefined;
    if (center && Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
      return new Vec3(center.x!, center.y!, center.z!);
    }
  }

  const bound = record.bound;
  if (bound && typeof bound === 'object') {
    const b = bound as { min?: number[]; max?: number[] };
    if (Array.isArray(b.min) && Array.isArray(b.max) && b.min.length >= 3 && b.max.length >= 3) {
      return new Vec3(
        (b.min[0]! + b.max[0]!) * 0.5,
        (b.min[1]! + b.max[1]!) * 0.5,
        (b.min[2]! + b.max[2]!) * 0.5,
      );
    }
  }

  for (const key of ['resource', 'data', 'splatData', 'gsplat', 'lodResource', 'octree']) {
    const nested = readAabbCenter(record[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function readPerformanceMemory(): { usedMB?: number; totalMB?: number } | undefined {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
    };
  }).memory;
  if (!memory) return undefined;
  return {
    usedMB: typeof memory.usedJSHeapSize === 'number' ? memory.usedJSHeapSize / 1048576 : undefined,
    totalMB: typeof memory.totalJSHeapSize === 'number' ? memory.totalJSHeapSize / 1048576 : undefined,
  };
}

export class PlayCanvasGsplatRuntime implements ViewerRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly manifest: ViewerManifest;
  private readonly options: ViewerOptions;
  private resolvedAsset: ResolvedViewerAsset;
  private readonly xrQuality: XrQuality;

  private markers: MarkerPoint[];
  private currentQuality: QualityPreset;
  private currentCameraMode: CameraMode;
  private rendererMode: RendererBackend = 'webgl2';
  private rendererPipeline: WebgpuPipelineMode = 'raster-cpu-sort';
  private loadPhase: ViewerLoadPhase = 'idle';

  private app: GsplatApp | null = null;
  private cameraRoot: Entity | null = null;
  private camera: Entity | null = null;
  private splatEntity: Entity | null = null;
  private splatAsset: Asset | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private markerLayer: HTMLDivElement | null = null;
  private markerButtons = new Map<string, HTMLButtonElement>();
  private selectedMarkerId: string | null = null;
  private statsIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastSortTimeMs: number | undefined;
  private lodLoadingCount = 0;
  private questPerfEnabled = false;
  private questPerfOverrides: ViewerQuestPerfRuntimeOverrides = {};
  private lastCpuBuckets: ViewerQuestPerfCpuBuckets | undefined;
  private gpuTimer: GpuTimerState | null = null;

  private yaw = 0;
  private pitch = -0.2;
  private distance = 4;
  private target = new Vec3(0, 0.3, 0);
  private sceneCenter = new Vec3(0, 0, 0);
  private isDragging = false;
  private isRightDrag = false;
  private pointerGestureMode: PointerGestureMode = 'none';
  private primaryPointerId: number | null = null;
  private readonly activePointers = new Map<number, TrackedPointer>();
  private touchGestureState: TouchGestureState | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private fpsSamples: number[] = [];
  private lastUpdateTime = 0;
  private loadedSplats = 0;
  private destroyed = false;
  private adaptiveQualityScale = 1;
  private lastAdaptiveAdjustTime = 0;
  private frameTimeSamples: number[] = [];
  private lastFrameTimeMs = 0;
  private sceneRadius = 4;
  // Fly mode state
  private flyYaw = 0;
  private flyPitch = 0;
  private flyMoveSpeed = 4.0;
  private flyJoystickLayer: HTMLDivElement | null = null;
  private flyMoveJoystick: VirtualJoystickState = { pointerId: null, x: 0, y: 0 };
  private flyLookJoystick: VirtualJoystickState = { pointerId: null, x: 0, y: 0 };
  // VR locomotion state
  private vrActive = false;
  private activeXrFramebufferScale: number | undefined;
  private activeXrFixedFoveation: number | null = null;
  private readonly vrMoveSpeed = 2.4;
  private readonly vrVerticalSpeed = 1.5;
  private vrScaleGesture: VrScaleGestureState | null = null;
  private pendingQualityMarkerUpdate = false;
  private depthPicker: Picker | null = null;
  private cachedDepthPick: CachedDepthPick | null = null;
  private depthPickRequestId = 0;
  private lastDepthPickRequestTime = 0;
  private pendingWheelDeltaY = 0;
  private wheelProcessing = false;
  private orbitAnchorGizmo: HTMLDivElement | null = null;
  private orbitAnchorTransition: OrbitAnchorTransition | null = null;

  constructor(options: ViewerOptions) {
    this.canvas = options.canvas;
    this.manifest = options.manifest;
    this.options = options;
    this.markers = options.markers || options.annotations || [];
    this.currentQuality = options.quality || this.manifest.viewer.quality || 'auto';
    this.currentCameraMode = options.cameraMode || (options.locked ? 'locked' : 'orbit');
    this.xrQuality = options.xrQuality || 'balanced';
    this.questPerfEnabled = Boolean(options.questPerfEnabled);
    this.resolvedAsset = resolveViewerAsset(this.manifest, options.assetVariant);
  }

  async start(): Promise<void> {
    if (this.app) return;
    this.destroyed = false;
    this.setupCanvas();
    this.emitProgress('loading-metadata', 'Preparing PlayCanvas GSplat runtime');

    const requested = this.options.rendererMode || 'auto';
    this.resolvedAsset = resolveViewerAsset(this.manifest, this.options.assetVariant, false);
    const profile = this.getCurrentQualityProfile();
    this.rendererMode = chooseRendererMode({
      requested,
      isVrActive: false,
      webgpuSupported: isWebGPUAvailable(),
      preferred: profile.preferredRenderer,
    });

    try {
      await this.createApp(this.rendererMode);
    } catch (error) {
      if (this.rendererMode === 'webgpu') {
        console.warn('[GsplatViewer] PlayCanvas WebGPU init failed, falling back to WebGL2:', error);
        this.rendererMode = 'webgl2';
        await this.createApp('webgl2');
      } else {
        throw error;
      }
    }

    this.configureScene();
    this.createCamera();
    this.createLights();
    this.createMarkerLayer();
    this.setMarkers(this.markers);
    this.applyQualitySettings();
    this.setupInput();
    this.setupResize();

    this.app!.start();
    this.statsIntervalId = setInterval(() => this.emitStats(), 1000);
    await this.loadGsplatAsset();
    this.emitProgress(this.resolvedAsset.isLod ? 'refining' : 'complete', this.resolvedAsset.isLod ? 'LOD scene is renderable; refinement may continue' : 'Scene loaded');
    this.updateRenderPolicy();
    this.options.onReady?.();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.removeInput();
    this.markerLayer?.remove();
    this.markerLayer = null;
    this.orbitAnchorGizmo?.remove();
    this.orbitAnchorGizmo = null;
    this.markerButtons.clear();
    this.selectedMarkerId = null;
    this.removeFlyJoysticks();
    this.depthPicker?.destroy();
    this.depthPicker = null;
    this.cachedDepthPick = null;
    this.orbitAnchorTransition = null;
    this.splatAsset = null;
    this.splatEntity = null;
    this.camera = null;
    this.cameraRoot = null;

    // Release GPU context before destroying the app so a subsequent
    // start() on the same canvas can acquire a fresh context cleanly.
    // WebGL contexts are released via the WEBGL_lose_context extension;
    // WebGPU contexts are released implicitly when the app destroys the device.
    const gl = this.canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    }

    this.app?.destroy();
    this.app = null;

    // Reset canvas dimensions to force clean GPU context state
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.pendingQualityMarkerUpdate = false;
  }

  setQuality(quality: QualityPreset): void {
    this.currentQuality = quality;
    this.adaptiveQualityScale = 1;
    this.frameTimeSamples.length = 0;
    this.applyQualitySettings();
    // Defer marker position update by one frame so PlayCanvas's postUpdate
    // has rebuilt the camera projection matrix after the DPR / canvas resize.
    // Without this, updateMarkerPositions() runs in the current frame's
    // onUpdate (before postUpdate) with a stale projection → wrong positions.
    this.pendingQualityMarkerUpdate = true;
    this.requestRender();
  }

  setCameraMode(mode: CameraMode): void {
    const previousMode = this.currentCameraMode;
    this.currentCameraMode = mode;
    this.activePointers.clear();
    this.touchGestureState = null;
    this.primaryPointerId = null;
    this.isDragging = false;
    if (mode === 'fly') {
      if (this.camera) {
        const forward = this.camera.forward.clone();
        this.flyYaw = Math.atan2(forward.x, forward.z);
        const horizontalLen = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
        this.flyPitch = Math.atan2(forward.y, horizontalLen);
      }
      this.flyMoveSpeed = 4.0;
      this.canvas.style.cursor = 'none';
      if (this.isCoarsePointer()) {
        this.createFlyJoysticks();
      } else {
        this.canvas.requestPointerLock();
      }
    } else if (mode === 'locked') {
      this.removeFlyJoysticks();
      this.canvas.style.cursor = 'default';
      document.exitPointerLock();
    } else {
      this.removeFlyJoysticks();
      if (previousMode === 'fly') this.syncOrbitFromCameraPose();
      this.canvas.style.cursor = 'grab';
      document.exitPointerLock();
    }
    this.updateRenderPolicy();
    if (previousMode !== mode) {
      this.options.onCameraModeChange?.(mode);
    }
    this.updateOrbitAnchorGizmo();
    this.requestRender();
  }

  private syncOrbitFromCameraPose(): void {
    if (!this.camera) return;
    const pos = this.camera.getPosition().clone();
    const forward = this.camera.forward.clone();
    if (forward.lengthSq() <= 1e-8) return;
    forward.normalize();
    const maxDistance = Math.max(200, this.sceneRadius * 20);
    const orbitDistance = clamp(this.distance || this.sceneRadius * 1.5 || 4, 0.25, maxDistance);
    this.target = pos.clone().add(forward.mulScalar(orbitDistance));
    const offset = pos.clone().sub(this.target);
    this.yaw = Math.atan2(offset.x, offset.z);
    const horizontalLen = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
    this.pitch = clamp(Math.atan2(offset.y, horizontalLen), -1.5, 1.5);
    this.distance = orbitDistance;
    this.updateCamera();
    this.camera.setPosition(pos.x, pos.y, pos.z);
    this.camera.lookAt(this.target);
  }

  setMarkers(points: MarkerPoint[]): void {
    this.markers = points;
    this.markerButtons.forEach((button) => button.remove());
    this.markerButtons.clear();
    if (this.selectedMarkerId && !points.some((point) => point.id === this.selectedMarkerId)) {
      this.selectedMarkerId = null;
    }
    if (!this.markerLayer || this.options.showMarkers === false) return;

    for (const point of this.markers) {
      const button = this.createMarkerButton(point);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selectedMarkerId = this.selectedMarkerId === point.id ? null : point.id;
        this.refreshMarkerExpansion();
        this.options.onMarkerSelect?.(point);
      });
      this.markerLayer.appendChild(button);
      this.markerButtons.set(point.id, button);
    }
    this.refreshMarkerExpansion();
    this.updateMarkerLayerVisibility();
    this.updateMarkerPositions();
  }

  /** @deprecated Use setMarkers. */
  setAnnotations(points: MarkerPoint[]): void {
    this.setMarkers(points);
  }

  setQuestPerfEnabled(enabled: boolean): void {
    this.questPerfEnabled = enabled;
    if (!enabled) {
      this.lastCpuBuckets = undefined;
    }
    this.setupGpuTimer();
  }

  setQuestPerfOverrides(overrides: ViewerQuestPerfRuntimeOverrides): void {
    this.questPerfOverrides = { ...overrides };
    const fixedFoveation = this.questPerfOverrides.xrFixedFoveation;
    if (this.vrActive && typeof fixedFoveation === 'number' && Number.isFinite(fixedFoveation)) {
      const xr = this.app?.xr as RuntimeXrManagerLike | undefined;
      try {
        if (xr) {
          xr.fixedFoveation = clamp(fixedFoveation, 0, 1);
          this.activeXrFixedFoveation = clamp(fixedFoveation, 0, 1);
        }
      } catch (error) {
        console.warn('[GsplatViewer] Unable to update XR fixed foveation for Quest perf experiment:', error);
      }
    }
    this.applyQualitySettings();
    this.updateMarkerLayerVisibility();
    this.requestRender();
  }

  private createMarkerButton(point: MarkerPoint): HTMLButtonElement {
    const accent = point.color || '#f5f5f5';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gsplat-marker';
    button.title = point.body ? `${point.title}: ${point.body}` : point.title;
    button.setAttribute('aria-expanded', 'false');
    button.dataset.markerId = point.id;
    button.style.position = 'absolute';
    button.style.transform = 'translate(-50%, -50%) scale(1)';
    button.style.transformOrigin = '50% 50%';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.gap = '7px';
    button.style.maxWidth = '190px';
    button.style.minHeight = '28px';
    button.style.padding = '6px 10px';
    button.style.border = '1px solid rgba(255,255,255,0.35)';
    button.style.borderRadius = '999px';
    button.style.background = 'rgba(12,12,12,0.82)';
    button.style.color = '#f7f7f7';
    button.style.font = '600 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    button.style.textAlign = 'left';
    button.style.whiteSpace = 'normal';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 8px 26px rgba(0,0,0,0.38)';
    button.style.pointerEvents = 'auto';
    button.style.overflow = 'hidden';
    button.style.backdropFilter = 'blur(10px)';
    button.style.transition = 'transform 180ms ease, max-width 180ms ease, padding 180ms ease, border-radius 180ms ease, background 180ms ease, box-shadow 180ms ease, opacity 120ms ease';

    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = accent;
    dot.style.boxShadow = `0 0 0 4px ${accent}33, 0 0 18px ${accent}`;
    dot.style.flex = '0 0 auto';
    button.appendChild(dot);

    const content = document.createElement('span');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.minWidth = '0';
    content.style.gap = '3px';
    content.style.pointerEvents = 'none';

    const title = document.createElement('span');
    title.textContent = point.title;
    title.style.display = 'block';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    title.style.whiteSpace = 'nowrap';
    title.style.lineHeight = '1.2';
    content.appendChild(title);

    const body = document.createElement('span');
    body.className = 'gsplat-marker-body';
    body.textContent = point.body || '';
    body.style.display = point.body ? 'block' : 'none';
    body.style.maxHeight = '0';
    body.style.opacity = '0';
    body.style.overflow = 'hidden';
    body.style.color = 'rgba(255,255,255,0.78)';
    body.style.font = '400 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    body.style.lineHeight = '1.35';
    body.style.transition = 'max-height 180ms ease, opacity 160ms ease';
    content.appendChild(body);

    button.appendChild(content);
    return button;
  }

  private refreshMarkerExpansion(): void {
    this.markerButtons.forEach((button, id) => {
      const expanded = id === this.selectedMarkerId;
      const body = button.querySelector<HTMLElement>('.gsplat-marker-body');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.style.zIndex = expanded ? '8' : '4';
      button.style.maxWidth = expanded ? '280px' : '190px';
      button.style.padding = expanded ? '10px 12px' : '6px 10px';
      button.style.borderRadius = expanded ? '10px' : '999px';
      button.style.background = expanded ? 'rgba(12,12,12,0.94)' : 'rgba(12,12,12,0.82)';
      button.style.boxShadow = expanded ? '0 14px 42px rgba(0,0,0,0.52)' : '0 8px 26px rgba(0,0,0,0.38)';
      button.style.transform = expanded ? 'translate(-50%, -50%) scale(1.04)' : 'translate(-50%, -50%) scale(1)';
      if (body) {
        body.style.maxHeight = expanded ? '120px' : '0';
        body.style.opacity = expanded ? '1' : '0';
      }
    });
  }

  enterVr(): Promise<void> {
    if (!this.app || !this.camera?.camera) {
      return Promise.reject(new Error('Viewer is not ready for VR'));
    }
    if (this.rendererMode === 'webgpu') {
      return Promise.reject(new Error('VR requires the WebGL2 renderer. Switch to WebGL2 first.'));
    }
    if (!this.app.xr?.supported || !this.app.xr.isAvailable(XRTYPE_VR)) {
      return Promise.reject(new Error('Immersive VR not supported on this device/browser'));
    }

    // Wrap PlayCanvas' callback-based xr.start() into a Promise so the caller
    // can await the XR session and catch errors (required by WebXR user-gesture flow).
    return new Promise<void>((resolve, reject) => {
      try {
        const profile = qualityProfiles.vrQuest;
        const framebufferScaleFactor = this.getXrFramebufferScale(profile);
        const fixedFoveation = this.getXrFixedFoveation(profile);
        this.app!.xr!.start(this.camera!.camera!, XRTYPE_VR, XRSPACE_LOCALFLOOR, {
          framebufferScaleFactor,
          callback: (error?: Error | null) => {
            if (error) {
              reject(error);
            } else {
              // Capture the session for gamepad polling and bind end event
              this.vrActive = true;
              this.activeXrFramebufferScale = framebufferScaleFactor;
              this.activeXrFixedFoveation = fixedFoveation;
              this.setOverlayHiddenForVr(true);
              const xr = this.app!.xr as RuntimeXrManagerLike;
              try {
                xr.fixedFoveation = fixedFoveation;
              } catch (foveationError) {
                console.warn('[GsplatViewer] Unable to apply XR fixed foveation:', foveationError);
              }
              xr.updateTargetFrameRate?.(profile.targetFps, () => undefined);
              this.applyQualitySettings();
              this.updateRenderPolicy();
              this.options.onVrSessionChange?.(true);
              const session = (this.app!.xr as unknown as { _session?: RuntimeXrSessionLike })._session;
              if (session) {
                session.addEventListener('end', this.onVrSessionEnd, { once: true });
              }
              resolve();
            }
          },
        });
      } catch (syncError) {
        reject(syncError instanceof Error ? syncError : new Error(String(syncError)));
      }
    });
  }

  private onVrSessionEnd = (): void => {
    this.finishVrSession();
  };

  async exitVr(): Promise<void> {
    const wasActive = this.vrActive;
    if (this.app?.xr?.active) {
      this.app.xr.end();
    }
    if (wasActive) {
      this.finishVrSession();
    }
  }

  private finishVrSession(): void {
    const wasActive = this.vrActive;
    this.vrActive = false;
    this.vrScaleGesture = null;
    this.activeXrFramebufferScale = undefined;
    this.activeXrFixedFoveation = null;
    this.setOverlayHiddenForVr(false);
    this.applyQualitySettings();
    this.updateRenderPolicy();
    if (wasActive) {
      this.options.onVrSessionChange?.(false);
    }
  }

  private async createApp(rendererMode: RendererBackend): Promise<void> {
    const profile = this.getCurrentQualityProfile();
    // Always include both backends so PlayCanvas can fall through if the
    // canvas retains a stale GPU context binding from a previous instance.
    const deviceTypes = rendererMode === 'webgpu' ? ['webgpu', 'webgl2'] : ['webgl2', 'webgpu'];
    const deviceOptions = {
      deviceTypes,
      antialias: profile.antialias,
      depth: true,
      stencil: false,
      xrCompatible: rendererMode !== 'webgpu',
      powerPreference: 'high-performance' as const,
      preserveDrawingBuffer: true,
    };
    const device = await createGraphicsDevice(this.canvas, deviceOptions);
    this.rendererMode = device.deviceType === 'webgpu' ? 'webgpu' : 'webgl2';
    device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxDevicePixelRatio);

    this.app = new GsplatApp(this.canvas, {
      graphicsDevice: device,
      mouse: new Mouse(this.canvas),
      touch: new TouchDevice(this.canvas),
      keyboard: new Keyboard(window),
    });
    this.setupGpuTimer();
  }

  private configureScene(): void {
    if (!this.app) return;
    this.app.scene.ambientLight = new Color(0.51, 0.55, 0.65);
    this.app.scene.on('gsplat:sorted', this.onGsplatSorted, this);
    this.app.systems.gsplat?.on('frame:ready', this.onGsplatFrameReady, this);
    this.app.on('prerender', this.onPreRender, this);
    this.app.on('postrender', this.onPostRender, this);
    this.applyGsplatSettings();
  }

  private setupGpuTimer(): void {
    if (!this.questPerfEnabled || this.rendererMode !== 'webgl2') {
      this.gpuTimer = this.gpuTimer ? { ...this.gpuTimer, status: 'disabled' } : null;
      return;
    }
    const gl = this.canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;
    const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimerState['ext'] | null;
    if (!gl || !ext) {
      this.gpuTimer = null;
      return;
    }
    this.gpuTimer = {
      gl,
      ext,
      activeQuery: null,
      pendingQuery: null,
      lastTimeMs: undefined,
      status: 'pending',
    };
  }

  private onPreRender = (): void => {
    const timer = this.gpuTimer;
    if (!this.questPerfEnabled || !timer || timer.status === 'disabled' || timer.activeQuery || timer.pendingQuery) return;
    const query = timer.gl.createQuery();
    if (!query) {
      timer.status = 'unsupported';
      return;
    }
    timer.activeQuery = query;
    try {
      timer.gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, query);
      timer.status = 'pending';
    } catch {
      timer.gl.deleteQuery(query);
      timer.activeQuery = null;
      timer.status = 'unsupported';
    }
  };

  private onPostRender = (): void => {
    const timer = this.gpuTimer;
    if (!timer || !timer.activeQuery) {
      this.resolveGpuTimer();
      return;
    }
    try {
      timer.gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
      timer.pendingQuery = timer.activeQuery;
      timer.activeQuery = null;
      timer.status = 'pending';
    } catch {
      timer.gl.deleteQuery(timer.activeQuery);
      timer.activeQuery = null;
      timer.status = 'unsupported';
    }
    this.resolveGpuTimer();
  };

  private resolveGpuTimer(): void {
    const timer = this.gpuTimer;
    if (!timer?.pendingQuery) return;
    const available = Boolean(timer.gl.getQueryParameter(timer.pendingQuery, timer.gl.QUERY_RESULT_AVAILABLE));
    const disjoint = Boolean(timer.gl.getParameter(timer.ext.GPU_DISJOINT_EXT));
    if (!available) return;
    if (disjoint) {
      timer.status = 'disjoint';
      timer.gl.deleteQuery(timer.pendingQuery);
      timer.pendingQuery = null;
      return;
    }
    const elapsedNs = timer.gl.getQueryParameter(timer.pendingQuery, timer.gl.QUERY_RESULT) as number;
    timer.lastTimeMs = elapsedNs / 1_000_000;
    timer.status = 'available';
    timer.gl.deleteQuery(timer.pendingQuery);
    timer.pendingQuery = null;
  }

  private createCamera(): void {
    this.cameraRoot = new Entity('camera-root');
    this.camera = new Entity('camera');
    this.cameraRoot.addChild(this.camera);
    this.app!.root.addChild(this.cameraRoot);
    const settings = this.getEffectiveQualitySettings();

    this.camera.addComponent('camera', {
      clearColor: new Color(0.02, 0.02, 0.02),
      nearClip: settings.nearClip,
      farClip: 1000,
      fov: 60,
    });

    const defaultCamera = this.manifest.viewer.defaultCamera;
    if (defaultCamera?.target) {
      this.target.set(defaultCamera.target[0], defaultCamera.target[1], defaultCamera.target[2]);
    }
    if (defaultCamera?.position) {
      const pos = new Vec3(defaultCamera.position[0], defaultCamera.position[1], defaultCamera.position[2]);
      this.distance = Math.max(0.25, pos.clone().sub(this.target).length());
      const dx = pos.x - this.target.x;
      const dy = pos.y - this.target.y;
      const dz = pos.z - this.target.z;
      this.yaw = Math.atan2(dx, dz);
      this.pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dy / this.distance)));
    }
    if (defaultCamera?.fov && this.camera.camera) {
      this.camera.camera.fov = defaultCamera.fov;
    }
    this.updateCamera();
  }

  private createLights(): void {
    const light = new Entity('light');
    light.setEulerAngles(35, 45, 0);
    light.addComponent('light', {
      color: new Color(1.0, 0.98, 0.957),
      intensity: 1,
    });
    this.app!.root.addChild(light);
  }

  private async loadGsplatAsset(): Promise<void> {
    if (!this.app) return;
    if (!this.resolvedAsset.url) {
      throw new Error('Viewer manifest does not include a renderable GSplat URL');
    }

    this.emitProgress('loading-asset', 'Loading Gaussian splat asset', undefined, undefined, this.resolvedAsset.url);

    const filename = filenameFromUrl(this.resolvedAsset.url);
    const data = this.resolvedAsset.source === 'meta'
      ? await this.fetchMetaJson(this.resolvedAsset.url)
      : undefined;

    const asset = new Asset(filename, 'gsplat', {
      url: this.resolvedAsset.url,
      filename,
    }, data);
    this.splatAsset = asset;

    await new Promise<void>((resolve, reject) => {
      asset.on('load', () => {
        if (this.destroyed) return;

        // Diagnostic: log resource state and canvas dimensions
        const hasResource = asset.resource != null;
        const canvasW = this.canvas?.clientWidth ?? 0;
        const canvasH = this.canvas?.clientHeight ?? 0;
        const bufferW = this.canvas?.width ?? 0;
        const bufferH = this.canvas?.height ?? 0;
        const gl = this.canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
        const glError = gl?.getError() ?? 0;
        console.log(`[GsplatViewer] Asset loaded:`, {
          url: this.resolvedAsset.url,
          format: this.resolvedAsset.format,
          hasResource,
          resourceType: asset.resource?.constructor?.name ?? 'null',
          canvasClient: `${canvasW}x${canvasH}`,
          canvasBuffer: `${bufferW}x${bufferH}`,
          glError: glError !== 0 ? glError : 'none',
          crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'n/a',
        });

        this.sceneRadius = readAabbRadius(asset.resource) || readAabbRadius(asset) || this.sceneRadius;
        const rawCenter = readAabbCenter(asset.resource) || readAabbCenter(asset) || new Vec3(0, 0, 0);
        const settings = this.getEffectiveQualitySettings();
        this.splatEntity = new Entity('gsplat');
        this.splatEntity.addComponent('gsplat', {
          unified: true,
          highQualitySH: settings.highQualitySH,
          lodBaseDistance: settings.lodBaseDistance,
          lodMultiplier: settings.lodMultiplier,
          asset,
        });
        this.app!.root.addChild(this.splatEntity);

        // Apply pretransform from manifest
        const pretransform = this.manifest.viewer.pretransform;
        if (pretransform) {
          const pos = pretransform.position;
          const rot = pretransform.rotation;
          const scl = pretransform.scale;
          if (pos && pos.length >= 3) {
            this.splatEntity.setLocalPosition(pos[0]!, pos[1]!, pos[2]!);
          }
          if (rot && rot.length >= 3) {
            this.splatEntity.setLocalEulerAngles(rot[0]!, rot[1]!, rot[2]!);
          }
          if (scl && scl.length >= 3) {
            this.splatEntity.setLocalScale(scl[0]!, scl[1]!, scl[2]!);
          }
        }
        const worldCenter = rawCenter.clone();
        this.splatEntity.getWorldTransform().transformPoint(rawCenter, worldCenter);
        this.sceneCenter.copy(worldCenter);

        this.applyGsplatSettings();
        this.loadedSplats = readPossibleCount(asset.resource) || readPossibleCount(asset) || this.manifestHasCount();
        this.emitProgress('renderable', 'First renderable splat frame is available', undefined, undefined, this.resolvedAsset.url);

        // Delayed diagnostic: check rendering state after 3 seconds
        setTimeout(() => {
          if (this.destroyed) return;
          const frameStats = (this.app?.stats as { frame?: { gsplats?: number } } | undefined)?.frame;
          const gsplatComp = (this.splatEntity as unknown as { gsplat?: { _placement?: unknown; _instance?: unknown; enabled?: boolean } } | null)?.gsplat;
          console.log(`[GsplatViewer] Render diagnostic (3s):`, {
            sortTimeMs: this.lastSortTimeMs,
            frameGsplats: frameStats?.gsplats,
            loadedSplats: this.loadedSplats,
            hasPlacement: gsplatComp?._placement != null,
            hasInstance: gsplatComp?._instance != null,
            componentEnabled: gsplatComp?.enabled,
            entityEnabled: this.splatEntity?.enabled,
            sceneChildren: this.app?.root?.children?.length,
            canvasPixels: `${this.canvas?.width}x${this.canvas?.height}`,
          });
        }, 3000);

        resolve();
      });
      asset.on('progress', (received: number, length: number) => {
        this.emitProgress('loading-asset', 'Loading Gaussian splat asset', received, length, this.resolvedAsset.url);
      });
      asset.on('error', (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      this.app!.assets.add(asset);
      this.app!.assets.load(asset);
    });
  }

  private async fetchMetaJson(url: string): Promise<object> {
    this.emitProgress('loading-metadata', 'Loading SOG metadata', undefined, undefined, url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SOG metadata fetch failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('SOG metadata response was not a JSON object');
    }
    return data;
  }

  private getCurrentQualityProfile(): QualityProfile {
    if (this.vrActive || this.options.assetVariant === 'vr') {
      return qualityProfiles.vrQuest;
    }
    return qualityForPreset(this.currentQuality);
  }

  private getXrFramebufferScale(profile = qualityProfiles.vrQuest): number {
    if (typeof this.questPerfOverrides.xrFramebufferScale === 'number' && Number.isFinite(this.questPerfOverrides.xrFramebufferScale)) {
      return clamp(this.questPerfOverrides.xrFramebufferScale, 0.35, 1);
    }
    if (typeof this.options.xrFramebufferScale === 'number' && Number.isFinite(this.options.xrFramebufferScale)) {
      return clamp(this.options.xrFramebufferScale, 0.35, 1);
    }
    if (this.xrQuality === 'performance') return 0.5;
    if (this.xrQuality === 'quality') return 0.75;
    return clamp(profile.xrFramebufferScale ?? 0.6, 0.35, 1);
  }

  private getXrFixedFoveation(profile = qualityProfiles.vrQuest): number {
    if (typeof this.questPerfOverrides.xrFixedFoveation === 'number' && Number.isFinite(this.questPerfOverrides.xrFixedFoveation)) {
      return clamp(this.questPerfOverrides.xrFixedFoveation, 0, 1);
    }
    if (typeof this.options.xrFixedFoveation === 'number' && Number.isFinite(this.options.xrFixedFoveation)) {
      return clamp(this.options.xrFixedFoveation, 0, 1);
    }
    if (this.xrQuality === 'quality') return 0.65;
    if (this.xrQuality === 'performance') return 1;
    return clamp(profile.xrFixedFoveation ?? 1, 0, 1);
  }

  private getEffectiveQualitySettings(profile = this.getCurrentQualityProfile()): EffectiveQualitySettings {
    const scale = profile.adaptiveQualityEnabled ? this.adaptiveQualityScale : 1;
    const degradation = 1 / Math.max(0.35, scale);
    const budgetScale = this.resolvedAsset.isLod ? scale : 1;
    const splatBudget = this.questPerfOverrides.splatBudget ?? this.options.budgetOverride ?? Math.max(1, Math.round(profile.splatBudget * budgetScale));
    const lodRange: [number, number] = [...profile.lodRange];

    if (this.resolvedAsset.isLod && scale < 0.6 && lodRange[0] < lodRange[1]) {
      lodRange[0] = Math.min(lodRange[1], lodRange[0] + 1);
    }

    return {
      splatBudget,
      maxDevicePixelRatio: Math.max(0.5, profile.maxDevicePixelRatio * Math.sqrt(scale)),
      maxPixelDim: profile.maxPixelDim,
      minPixelSize: this.questPerfOverrides.minPixelSize ?? profile.minPixelSize * degradation,
      minContribution: this.questPerfOverrides.minContribution ?? profile.minContribution * degradation,
      alphaClip: Math.min(1 / 16, profile.alphaClip * degradation),
      lodBaseDistance: Math.max(0.1, this.sceneRadius * profile.lodBaseDistanceScale * Math.max(0.35, scale)),
      lodMultiplier: profile.lodMultiplier,
      lodRange,
      highQualitySH: this.questPerfOverrides.highQualitySH ?? (profile.highQualitySH && !this.options.disablePostFx),
      renderOnDemand: profile.renderOnDemand,
      antialias: profile.antialias && !this.options.disablePostFx,
      radialSorting: this.questPerfOverrides.radialSorting ?? Boolean(profile.radialSorting),
      nearClip: profile.nearClip ?? 0.03,
      maxPixelRadius: profile.maxPixelRadius,
      targetActiveSplats: profile.targetActiveSplats,
      lodUpdateAngle: profile.lodUpdateAngle ?? 60,
    };
  }

  private applyGsplatSettings(): void {
    if (!this.app) return;
    const profile = this.getCurrentQualityProfile();
    const settings = this.getEffectiveQualitySettings(profile);
    const gsplat = this.app.scene.gsplat as typeof this.app.scene.gsplat & {
      radialSorting?: boolean;
      maxPixelRadius?: number;
    };
    gsplat.antiAlias = settings.antialias;
    gsplat.alphaClip = settings.alphaClip;
    gsplat.minPixelSize = settings.minPixelSize;
    gsplat.minContribution = settings.minContribution;
    gsplat.splatBudget = settings.splatBudget;
    gsplat.lodRangeMin = settings.lodRange[0];
    gsplat.lodRangeMax = settings.lodRange[1];
    gsplat.lodBehindPenalty = 5;
    gsplat.lodUnderfillLimit = 10;
    gsplat.lodUpdateAngle = settings.lodUpdateAngle;
    gsplat.lodUpdateDistance = Math.max(0.1, this.sceneRadius * 0.02);
    gsplat.radialSorting = settings.radialSorting;
    if (settings.maxPixelRadius !== undefined) {
      gsplat.maxPixelRadius = settings.maxPixelRadius;
    }
    gsplat.debug = GSPLAT_DEBUG_NONE;
    // Always use CPU sort. GPU radix sort (GSPLAT_RENDERER_RASTER_GPU_SORT)
    // introduces a billboard effect where splats incorrectly rotate relative
    // to the camera. CPU sort runs in a dedicated Web Worker and preserves
    // world-space rotation quaternions correctly. At the maximum user-facing
    // budget of 900K splats, CPU sort takes 3–8ms in the worker thread,
    // which fits comfortably within a 60 fps frame budget.
    if (this.rendererMode === 'webgpu' && this.options.webgpuPipeline === 'compute-canary') {
      gsplat.renderer = GSPLAT_RENDERER_COMPUTE;
      this.rendererPipeline = 'compute-canary';
    } else {
      gsplat.renderer = GSPLAT_RENDERER_RASTER_CPU_SORT;
      this.rendererPipeline = 'raster-cpu-sort';
    }

    const component = (this.splatEntity as unknown as {
      gsplat?: {
        highQualitySH?: boolean;
        lodBaseDistance?: number;
        lodMultiplier?: number;
      };
    } | null)?.gsplat;
    if (component) {
      component.highQualitySH = settings.highQualitySH;
      component.lodBaseDistance = settings.lodBaseDistance;
      component.lodMultiplier = settings.lodMultiplier;
    }
  }

  private setupCanvas(): void {
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = this.currentCameraMode === 'locked' ? 'default' : 'grab';
    const parent = this.canvas.parentElement;
    if (parent) {
      const style = window.getComputedStyle(parent);
      if (style.position === 'static') {
        parent.style.position = 'relative';
      }
    }
  }

  private createMarkerLayer(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.markerLayer = document.createElement('div');
    this.markerLayer.className = 'gsplat-marker-layer';
    this.markerLayer.style.position = 'absolute';
    this.markerLayer.style.inset = '0';
    this.markerLayer.style.pointerEvents = 'none';
    this.markerLayer.style.overflow = 'hidden';
    this.markerLayer.style.zIndex = '4';
    parent.appendChild(this.markerLayer);
    this.createOrbitAnchorGizmo(parent);
    this.updateMarkerLayerVisibility();
  }

  private createOrbitAnchorGizmo(parent: HTMLElement): void {
    this.orbitAnchorGizmo?.remove();
    const gizmo = document.createElement('div');
    gizmo.className = 'gsplat-orbit-anchor';
    gizmo.setAttribute('aria-hidden', 'true');
    gizmo.style.position = 'absolute';
    gizmo.style.width = '14px';
    gizmo.style.height = '14px';
    gizmo.style.borderRadius = '50%';
    gizmo.style.border = '1px solid rgba(255,255,255,0.9)';
    gizmo.style.background = 'rgba(255,255,255,0.24)';
    gizmo.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.28), 0 4px 14px rgba(0,0,0,0.28)';
    gizmo.style.pointerEvents = 'none';
    gizmo.style.transform = 'translate(-50%, -50%)';
    gizmo.style.zIndex = '5';
    gizmo.style.display = 'none';
    parent.appendChild(gizmo);
    this.orbitAnchorGizmo = gizmo;
  }

  private setupResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.app?.on('update', this.onUpdate, this);
    this.resize();
  }

  private resize(): void {
    if (!this.app || this.app.xr?.active) return;
    const profile = this.getCurrentQualityProfile();
    const settings = this.getEffectiveQualitySettings(profile);
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const screenMin = Math.max(1, Math.min(window.screen?.width || width, window.screen?.height || height));
    const ratio = Math.min(settings.maxPixelDim / screenMin, window.devicePixelRatio || 1, settings.maxDevicePixelRatio);
    const bufferW = Math.ceil(width * ratio);
    const bufferH = Math.ceil(height * ratio);

    // Use graphicsDevice.setResolution to set buffer dimensions and fire
    // PlayCanvas' internal resizecanvas event, which triggers viewport and
    // projection matrix rebuilds. Do NOT call app.resizeCanvas — its default
    // FILLMODE_KEEP_ASPECT overrides canvas.style.width/height with absolute
    // pixel values computed to fill the window, breaking our responsive
    // 100%-of-container CSS sizing and inflating clientWidth via a
    // ResizeObserver cascade.
    this.app.graphicsDevice.setResolution(bufferW, bufferH);

    // Ensure the canvas CSS dimensions remain responsive (100% of parent
    // container) rather than absolute pixel values that app.resizeCanvas
    // would set. This keeps clientWidth/clientHeight aligned with the
    // container, which is what device.clientRect (used by worldToScreen)
    // reads via getBoundingClientRect().
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    // Synchronously update the camera aspect ratio so marker screen-space
    // positions computed in the same frame use the correct projection matrix.
    // Without this, PlayCanvas defers the projection rebuild to the next
    // render pass, and markers appear at incorrect positions after quality
    // switches (which change DPR / canvas resolution).
    if (this.camera?.camera) {
      this.camera.camera.aspectRatio = bufferW / Math.max(1, bufferH);
    }

    this.app.renderNextFrame = true;
  }

  private setupInput(): void {
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    // Pointer lock change handler for fly mode
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private removeInput(): void {
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.exitPointerLock();
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.currentCameraMode !== 'orbit' || event.button !== 0 || this.vrActive) return;
    event.preventDefault();
    void this.setOrbitTargetFromClientPoint(event.clientX, event.clientY);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.currentCameraMode === 'locked') return;

    if (this.currentCameraMode === 'fly') {
      if (event.pointerType !== 'touch') {
        this.canvas.requestPointerLock();
      }
      return;
    }

    event.preventDefault();
    const tracked: TrackedPointer = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType,
      button: event.button,
      moved: false,
    };
    this.activePointers.set(event.pointerId, tracked);
    this.canvas.setPointerCapture?.(event.pointerId);

    if (event.pointerType === 'touch') {
      this.isDragging = true;
      this.isRightDrag = false;
      this.primaryPointerId = this.primaryPointerId ?? event.pointerId;
      this.pointerGestureMode = 'orbit';
      this.resetTouchGestureState();
      this.canvas.style.cursor = 'grabbing';
      this.updateRenderPolicy();
      this.requestRender();
      return;
    }

    // Left click = orbit, right click = pan.
    this.isDragging = true;
    this.isRightDrag = event.button === 2;
    this.pointerGestureMode = this.isRightDrag ? 'pan' : 'orbit';
    this.primaryPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.style.cursor = this.isRightDrag ? 'grabbing' : 'grabbing';
    this.updateRenderPolicy();
    this.requestRender();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || this.currentCameraMode === 'locked' || this.currentCameraMode === 'fly') return;
    const tracked = this.activePointers.get(event.pointerId);
    const touchDx = tracked ? event.clientX - tracked.x : 0;
    const touchDy = tracked ? event.clientY - tracked.y : 0;
    if (tracked) {
      tracked.moved = tracked.moved || distance2D({ x: tracked.startX, y: tracked.startY }, { x: event.clientX, y: event.clientY }) > 4;
      tracked.x = event.clientX;
      tracked.y = event.clientY;
    }

    if (event.pointerType === 'touch') {
      this.handleTouchPointerMove(touchDx, touchDy);
      return;
    }

    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    if (this.isRightDrag) {
      this.panOrbitTarget(dx, dy);
    } else {
      this.orbitByPointerDelta(dx, dy);
    }
    this.requestRender();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const tracked = this.activePointers.get(event.pointerId);
    const wasTap = tracked && !tracked.moved && distance2D({ x: tracked.startX, y: tracked.startY }, { x: event.clientX, y: event.clientY }) <= 4;
    const canSetTarget = Boolean(
      tracked &&
      wasTap &&
      this.currentCameraMode === 'orbit' &&
      this.activePointers.size <= 1 &&
      tracked.pointerType !== 'mouse',
    );

    if (canSetTarget && tracked) {
      void this.setOrbitTargetFromClientPoint(event.clientX, event.clientY);
    }

    this.activePointers.delete(event.pointerId);
    if (this.primaryPointerId === event.pointerId) {
      this.primaryPointerId = null;
    }
    if (this.activePointers.size === 0) {
      this.isDragging = false;
      this.isRightDrag = false;
      this.pointerGestureMode = 'none';
      this.touchGestureState = null;
    } else if (event.pointerType === 'touch') {
      this.resetTouchGestureState();
    }

    this.canvas.style.cursor = this.currentCameraMode === 'locked' ? 'default' : this.currentCameraMode === 'fly' ? 'none' : 'grab';
    this.updateRenderPolicy();
    this.requestRender();
  };

  private handleTouchPointerMove(dx: number, dy: number): void {
    const pointers = Array.from(this.activePointers.values());
    if (pointers.length >= 2) {
      const a = pointers[0]!;
      const b = pointers[1]!;
      const center = center2D(a, b);
      const distance = distance2D(a, b);

      if (!this.touchGestureState) {
        this.touchGestureState = {
          center,
          distance,
          depth: this.getOrbitDollyDepth(),
        };
        return;
      }

      const gesture = classifyTwoPointerGesture({
        previousDistance: this.touchGestureState.distance,
        currentDistance: distance,
        previousCenter: this.touchGestureState.center,
        currentCenter: center,
        scaleThresholdPx: 6,
        panThresholdPx: 3,
      });

      let nextDepth = this.touchGestureState.depth;
      if (gesture === 'dolly') {
        const factor = clamp(distance / Math.max(1, this.touchGestureState.distance), 0.88, 1.14);
        const anchorDepth = this.getOrbitDollyDepth();
        const maxStep = Math.max(this.sceneRadius * 0.035, 0.08);
        const rawStep = clamp(Math.log(factor) * anchorDepth * 0.75, -maxStep, maxStep);
        const step = clampDollyStepToDepth({
          step: rawStep,
          hitDepth: anchorDepth,
          sceneRadius: this.sceneRadius,
          nearSurfaceStop: this.getMinimumOrbitDistance(),
          forwardLimitRatio: 0.35,
        });
        this.dollyAlongOrbitAnchor(step);
        nextDepth = this.getOrbitDollyDepth();
      }

      this.touchGestureState = { center, distance, depth: nextDepth };
      this.requestRender();
      return;
    }

    if (pointers.length === 1) {
      this.orbitByPointerDelta(dx, dy);
      this.requestRender();
    }
  }

  private resetTouchGestureState(): void {
    const pointers = Array.from(this.activePointers.values());
    if (pointers.length >= 2) {
      const a = pointers[0]!;
      const b = pointers[1]!;
      const center = center2D(a, b);
      this.touchGestureState = {
        center,
        distance: distance2D(a, b),
        depth: this.getOrbitDollyDepth(),
      };
    } else {
      this.touchGestureState = null;
    }
  }

  private orbitByPointerDelta(dx: number, dy: number): void {
    this.orbitAnchorTransition = null;
    this.yaw -= dx * 0.0048;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0032));
    this.updateCamera();
  }

  private panOrbitTarget(dx: number, dy: number, depth = this.distance): void {
    if (!this.camera) return;
    this.orbitAnchorTransition = null;
    const right = this.camera.right.clone();
    const up = this.camera.up.clone();
    right.normalize();
    up.normalize();
    const d = Math.max(0.1, this.clampInteractionDepth(depth));
    const panSpeed = d * 0.003;
    this.target.sub(right.mulScalar(dx * panSpeed));
    this.target.add(up.mulScalar(dy * panSpeed));
    this.updateCamera();
  }

  private getRayFromClientPoint(clientX: number, clientY: number, offsetX = 0, offsetY = 0): { origin: Vec3; direction: Vec3 } | null {
    if (!this.camera?.camera) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left + offsetX;
    const y = clientY - rect.top + offsetY;
    const origin = this.camera.getPosition().clone();
    const far = this.camera.camera.farClip || 1000;
    const end = this.camera.camera.screenToWorld(x, y, far, new Vec3());
    const direction = end.clone().sub(origin);
    if (direction.lengthSq() <= 1e-8) return null;
    direction.normalize();
    return { origin, direction };
  }

  private intersectRaySceneSphere(origin: Vec3, direction: Vec3): { point: Vec3; distance: number } | null {
    const center = this.sceneCenter || this.target;
    let radius = Math.max(this.sceneRadius, 0.5);
    const scale = this.splatEntity?.getLocalScale();
    if (scale) {
      radius *= Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 0.01);
    }

    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;
    const b = ox * direction.x + oy * direction.y + oz * direction.z;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;

    const sqrtDisc = Math.sqrt(disc);
    let t = -b - sqrtDisc;
    if (t <= 0) t = -b + sqrtDisc;
    if (t <= 0 || !Number.isFinite(t)) return null;

    return { point: origin.clone().add(direction.clone().mulScalar(t)), distance: t };
  }

  private getFallbackInteractionDepth(): number {
    return this.clampInteractionDepth(Math.max(this.distance, this.sceneRadius, 0.25));
  }

  private getNearSurfaceStopDistance(): number {
    return clamp(this.sceneRadius * 0.004, 0.03, 1.5);
  }

  private getMinimumOrbitDistance(): number {
    return Math.max(0.1, this.getNearSurfaceStopDistance() * 0.5);
  }

  private getOrbitDollyDepth(): number {
    if (!this.camera) return Math.max(this.distance, this.getMinimumOrbitDistance());
    const distance = this.camera.getPosition().distance(this.target);
    return Number.isFinite(distance) && distance > 0 ? distance : Math.max(this.distance, this.getMinimumOrbitDistance());
  }

  private getAnchorProximityMoveScale(): number {
    const distance = this.getOrbitDollyDepth();
    const minDistance = this.getMinimumOrbitDistance();
    const slowRange = Math.max(minDistance * 12, this.sceneRadius * 0.03, 0.6);
    const t = clamp((distance - minDistance) / Math.max(1e-6, slowRange - minDistance), 0, 1);
    const eased = t * t * (3 - 2 * t);
    return clamp(0.18 + eased * 0.82, 0.18, 1);
  }

  private clampInteractionDepth(depth: number): number {
    const radius = Math.max(this.sceneRadius, 0.5);
    const minDepth = Math.max(radius * 0.035, 0.05);
    const maxDepth = Math.max(radius * 8, this.distance * 3, 2);
    const safeDepth = Number.isFinite(depth) && depth > 0 ? depth : Math.max(this.distance, radius, 0.25);
    return clamp(safeDepth, minDepth, maxDepth);
  }

  private intersectRayTargetPlane(origin: Vec3, direction: Vec3): { point: Vec3; distance: number } | null {
    if (!this.camera) return null;
    const normal = this.camera.forward.clone();
    if (normal.lengthSq() <= 1e-8) return null;
    normal.normalize();
    const denom = direction.dot(normal);
    if (Math.abs(denom) <= 1e-5) return null;
    const distance = this.target.clone().sub(origin).dot(normal) / denom;
    if (!Number.isFinite(distance) || distance <= 0.01) return null;
    return {
      point: origin.clone().add(direction.clone().mulScalar(distance)),
      distance,
    };
  }

  private getDepthPickAtClientPoint(clientX: number, clientY: number): DepthPick | null {
    const centerRay = this.getRayFromClientPoint(clientX, clientY);
    if (!centerRay) return null;

    const fallbackDepth = this.getFallbackInteractionDepth();
    const samples: number[] = [];
    for (const [offsetX, offsetY] of DEPTH_RAY_OFFSETS) {
      const ray = this.getRayFromClientPoint(clientX, clientY, offsetX, offsetY);
      if (!ray) continue;
      const hit = this.intersectRaySceneSphere(ray.origin, ray.direction);
      if (hit) samples.push(this.clampInteractionDepth(hit.distance));
    }

    const consensus = computeFrontDepthConsensus({
      samples,
      fallbackDepth,
      minSamples: 4,
      minClusterSamples: 2,
      maxClusterRelativeSpread: 0.35,
    });

    if (consensus.sampleCount >= 2 && consensus.confidence >= 0.25) {
      const distance = this.clampInteractionDepth(consensus.distance);
      return {
        point: centerRay.origin.clone().add(centerRay.direction.clone().mulScalar(distance)),
        distance,
        confidence: consensus.confidence,
        source: 'scene',
      };
    }

    const planeHit = this.intersectRayTargetPlane(centerRay.origin, centerRay.direction);
    if (planeHit) {
      const distance = this.clampInteractionDepth(planeHit.distance);
      return {
        point: centerRay.origin.clone().add(centerRay.direction.clone().mulScalar(distance)),
        distance,
        confidence: 0.25,
        source: 'target-plane',
      };
    }

    return {
      point: centerRay.origin.clone().add(centerRay.direction.clone().mulScalar(fallbackDepth)),
      distance: fallbackDepth,
      confidence: 0,
      source: 'fallback',
    };
  }

  private getCachedDepthPickAtClientPoint(clientX: number, clientY: number): DepthPick | null {
    if (!this.cachedDepthPick || !this.camera) return null;
    const now = performance.now();
    if (now - this.cachedDepthPick.time > 300) return null;
    if (distance2D({ x: clientX, y: clientY }, this.cachedDepthPick) > 32) return null;

    const cameraMoved = this.camera.getPosition().distance(this.cachedDepthPick.cameraPosition);
    const targetMoved = this.target.distance(this.cachedDepthPick.target);
    const movementTolerance = Math.max(this.sceneRadius * 0.01, 0.05);
    if (cameraMoved > movementTolerance || targetMoved > movementTolerance) return null;

    return this.cachedDepthPick.pick;
  }

  private getInteractionDepthPickAtClientPoint(clientX: number, clientY: number): DepthPick | null {
    const cached = this.getCachedDepthPickAtClientPoint(clientX, clientY);
    if (cached) return cached;

    const fallback = this.getDepthPickAtClientPoint(clientX, clientY);
    this.scheduleDepthPickAtClientPoint(clientX, clientY);
    return fallback;
  }

  private scheduleDepthPickAtClientPoint(clientX: number, clientY: number): void {
    if (!this.app || !this.camera?.camera || this.vrActive || this.destroyed) return;
    const now = performance.now();
    if (now - this.lastDepthPickRequestTime < 70) return;
    this.lastDepthPickRequestTime = now;
    const requestId = ++this.depthPickRequestId;

    void this.resolveDepthPickAtClientPoint(clientX, clientY).then((pick) => {
      if (this.destroyed || requestId !== this.depthPickRequestId || !pick || pick.source === 'fallback') return;
      this.cachedDepthPick = {
        x: clientX,
        y: clientY,
        time: performance.now(),
        cameraPosition: this.camera?.getPosition().clone() ?? new Vec3(),
        target: this.target.clone(),
        pick,
      };
    }).catch(() => {
      // Depth picking is opportunistic; the CPU fallback remains active.
    });
  }

  private async resolveDepthPickAtClientPoint(clientX: number, clientY: number): Promise<DepthPick | null> {
    const pickerPick = await this.getPickerDepthPickAtClientPoint(clientX, clientY);
    if (pickerPick) return pickerPick;
    return this.getDepthPickAtClientPoint(clientX, clientY);
  }

  private getPickerPoint(clientX: number, clientY: number, width: number, height: number, offsetX = 0, offsetY = 0): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left + offsetX, 0, Math.max(0, width - 1)),
      y: clamp(clientY - rect.top + offsetY, 0, Math.max(0, height - 1)),
    };
  }

  private ensureDepthPicker(width: number, height: number): Picker | null {
    if (!this.app) return null;
    if (!this.depthPicker) {
      this.depthPicker = new Picker(this.app, width, height, true);
    } else {
      this.depthPicker.resize(width, height);
    }
    return this.depthPicker;
  }

  private async getPickerDepthPickAtClientPoint(clientX: number, clientY: number): Promise<DepthPick | null> {
    if (!this.app || !this.camera?.camera || this.vrActive) return null;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width <= 1 || height <= 1) return null;

    const picker = this.ensureDepthPicker(width, height);
    const centerRay = this.getRayFromClientPoint(clientX, clientY);
    if (!picker || !centerRay) return null;

    try {
      picker.prepare(this.camera.camera, this.app.scene);
    } catch {
      return null;
    }

    const cameraPosition = this.camera.getPosition().clone();
    const sampleResults = await Promise.all(DEPTH_RAY_OFFSETS.map(async ([offsetX, offsetY], index) => {
      const pickerPoint = this.getPickerPoint(clientX, clientY, width, height, offsetX, offsetY);
      const ray = this.getRayFromClientPoint(clientX, clientY, offsetX, offsetY);
      if (!ray) return null;
      const point = await picker.getWorldPointAsync(pickerPoint.x, pickerPoint.y);
      if (!point) return null;
      const distance = point.clone().sub(cameraPosition).dot(ray.direction);
      if (!Number.isFinite(distance) || distance <= 0) return null;
      return {
        index,
        point,
        distance: this.clampInteractionDepth(distance),
      };
    }));

    const samples = sampleResults.filter((sample): sample is { index: number; point: Vec3; distance: number } => Boolean(sample));
    if (samples.length === 0) return null;

    const centerSample = samples.find((sample) => sample.index === 0);
    if (centerSample) {
      return {
        point: centerSample.point,
        distance: centerSample.distance,
        confidence: 0.8,
        source: 'scene',
      };
    }

    const fallbackDepth = this.getFallbackInteractionDepth();
    const consensus = computeFrontDepthConsensus({
      samples: samples.map((sample) => sample.distance),
      fallbackDepth,
      minSamples: 3,
      minClusterSamples: 2,
      maxClusterRelativeSpread: 0.32,
    });

    if (consensus.sampleCount < 2 || consensus.confidence < 0.25) return null;
    const distance = this.clampInteractionDepth(consensus.distance);
    return {
      point: centerRay.origin.clone().add(centerRay.direction.clone().mulScalar(distance)),
      distance,
      confidence: consensus.confidence,
      source: 'scene',
    };
  }

  private dollyAlongOrbitAnchor(step: number): void {
    if (!Number.isFinite(step) || Math.abs(step) < 1e-8) return;
    this.orbitAnchorTransition = null;
    if (!this.camera) return;

    const cameraPosition = this.camera.getPosition().clone();
    const anchorDirection = this.target.clone().sub(cameraPosition);
    const anchorDistance = anchorDirection.length();
    if (!Number.isFinite(anchorDistance) || anchorDistance <= 1e-6) return;

    const minDistance = this.getMinimumOrbitDistance();
    const forwardLimit = Math.max(0, anchorDistance - minDistance);
    const clampedStep = step > 0
      ? Math.min(step, forwardLimit, anchorDistance * 0.35)
      : step;
    if (Math.abs(clampedStep) < 1e-8) return;

    const nextCameraPosition = cameraPosition.add(anchorDirection.normalize().mulScalar(clampedStep));
    this.applyOrbitPoseFromCameraAndTarget(nextCameraPosition, this.target);
  }

  private async setOrbitTargetFromClientPoint(clientX: number, clientY: number): Promise<void> {
    const hit = await this.resolveDepthPickAtClientPoint(clientX, clientY);
    if (this.destroyed) return;
    if (!hit || !this.camera) return;
    if (hit.source === 'fallback') return;
    this.setOrbitTargetFromDepthPick(hit, true);
  }

  private setOrbitTargetFromDepthPick(hit: DepthPick, smooth: boolean): void {
    if (!this.camera) return;
    const pos = this.camera.getPosition().clone();
    const offset = pos.clone().sub(hit.point);
    const distance = offset.length();
    if (!Number.isFinite(distance) || distance <= 0.05) return;

    if (smooth) {
      this.orbitAnchorTransition = {
        from: this.target.clone(),
        to: hit.point.clone(),
        cameraPosition: pos,
        startTime: performance.now(),
        durationMs: 180,
      };
      this.requestRender();
      return;
    }

    this.applyOrbitPoseFromCameraAndTarget(pos, hit.point);
  }

  private applyOrbitPoseFromCameraAndTarget(cameraPosition: Vec3, target: Vec3): void {
    if (!this.camera) return;
    let offset = cameraPosition.clone().sub(target);
    let distance = offset.length();
    if (!Number.isFinite(distance) || distance <= 0.05) return;

    const minDistance = this.getMinimumOrbitDistance();
    if (distance < minDistance) {
      offset.normalize().mulScalar(minDistance);
      cameraPosition = target.clone().add(offset);
      distance = minDistance;
    }

    this.target.copy(target);
    this.distance = clamp(distance, minDistance, Math.max(200, this.sceneRadius * 20));
    this.yaw = Math.atan2(offset.x, offset.z);
    const horizontalLen = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
    this.pitch = clamp(Math.atan2(offset.y, horizontalLen), -1.5, 1.5);
    this.camera.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    this.camera.lookAt(this.target);
    this.requestRender();
  }

  private updateOrbitAnchorTransition(now: number): void {
    const transition = this.orbitAnchorTransition;
    if (!transition) return;
    const t = clamp((now - transition.startTime) / transition.durationMs, 0, 1);
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    const target = new Vec3().lerp(transition.from, transition.to, eased);
    this.applyOrbitPoseFromCameraAndTarget(transition.cameraPosition, target);
    if (t >= 1) {
      this.orbitAnchorTransition = null;
    }
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.currentCameraMode === 'locked') return;
    event.preventDefault();

    if (this.currentCameraMode === 'fly') {
      const zoomIn = event.deltaY < 0;
      const speedFactor = zoomIn ? 1.15 : 0.85;
      this.flyMoveSpeed = Math.max(0.5, Math.min(50, this.flyMoveSpeed * speedFactor));
      return;
    }

    this.pendingWheelDeltaY += normalizeWheelDeltaY(event.deltaY, event.deltaMode);
    void this.processPendingWheelDolly();
  };

  private async processPendingWheelDolly(): Promise<void> {
    if (this.wheelProcessing) return;
    this.wheelProcessing = true;
    try {
      while (!this.destroyed && Math.abs(this.pendingWheelDeltaY) > 0.001) {
        const deltaY = clamp(this.pendingWheelDeltaY, -400, 400);
        this.pendingWheelDeltaY -= deltaY;
        if (this.destroyed) return;
        const anchorDepth = this.getOrbitDollyDepth();
        const step = computeDepthAwareDollyStep({
          deltaY,
          deltaMode: 0,
          hitDepth: anchorDepth,
          sceneRadius: this.sceneRadius,
          maxStep: Math.max(this.sceneRadius * 0.08, 0.2),
          nearSurfaceStop: this.getMinimumOrbitDistance(),
          forwardLimitRatio: 0.35,
        });
        this.dollyAlongOrbitAnchor(step);
        this.requestRender();
      }
    } finally {
      this.wheelProcessing = false;
      if (!this.destroyed && Math.abs(this.pendingWheelDeltaY) > 0.001) {
        void this.processPendingWheelDolly();
      }
    }
  }

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked && this.currentCameraMode === 'fly') {
      document.addEventListener('mousemove', this.onFlyMouseMove);
      this.canvas.style.cursor = 'none';
    } else {
      document.removeEventListener('mousemove', this.onFlyMouseMove);
      if (!locked && this.currentCameraMode === 'fly' && !this.isCoarsePointer()) {
        this.setCameraMode('orbit');
        return;
      }
      this.canvas.style.cursor = this.currentCameraMode === 'locked' ? 'default' : 'grab';
    }
  };

  private onFlyMouseMove = (event: MouseEvent): void => {
    if (this.currentCameraMode !== 'fly') return;
    const dx = event.movementX;
    const dy = event.movementY;
    this.flyYaw -= dx * 0.003;
    this.flyPitch = Math.max(-1.5, Math.min(1.5, this.flyPitch - dy * 0.003));
    this.requestRender();
  };

  private updateVrLocomotion(dt: number): void {
    if (!this.vrActive || !this.app?.xr?.active || !this.camera) return;

    const inputSources = ((this.app.xr as unknown as {
      input?: { inputSources?: RuntimeXrInputSource[] };
    }).input?.inputSources) ?? [];
    if (inputSources.length === 0) return;

    const speed = this.vrMoveSpeed * dt;
    if (this.updateVrScaleGesture(inputSources)) {
      this.requestRender();
      return;
    }

    for (const source of inputSources) {
      const stick = readGamepadStick(source.gamepad, 0.18);
      if (stick.x === 0 && stick.y === 0) continue;

      // Left stick: axes[0]=left/right, axes[1]=up/down (Y is usually inverted: -1=up)
      const lx = stick.x;
      const ly = stick.y;

      // Right stick: axes[2]=left/right, axes[3]=up/down
      const rx = stick.x;
      // ry (axes[3]) is unused for head rotation — right stick X controls yaw

      // Determine if this is left or right hand based on handedness
      const isRightHand = source.handedness === 'right';

      if (isRightHand) {
        this.applyVrTurnAndVertical(rx, ly, dt);
      } else {
        this.applyVrMovement(lx, ly, speed);
      }
    }
  }

  /**
   * Apply VR joystick movement relative to the controller or head orientation.
   * Left stick: horizontal plane movement (forward/back/strafe).
   */
  private applyVrTurnAndVertical(stickX: number, stickY: number, dt: number): void {
    if (!this.cameraRoot) return;

    if (Math.abs(stickX) > 0) {
      this.rotateCameraRootAroundHead(-stickX * 55 * dt);
    }

    const vertical = -stickY;
    if (Math.abs(vertical) > 0) {
      const pos = this.cameraRoot.getPosition().clone();
      pos.y += vertical * this.vrVerticalSpeed * dt;
      this.cameraRoot.setPosition(pos);
    }
  }

  private rotateCameraRootAroundHead(yawDegrees: number): void {
    if (!this.cameraRoot || !this.camera) return;
    const headLocal = this.camera.getLocalPosition().clone();
    this.cameraRoot.translateLocal(headLocal);
    this.cameraRoot.rotateLocal(0, yawDegrees, 0);
    this.cameraRoot.translateLocal(headLocal.mulScalar(-1));
  }

  private isXrTriggerPressed(source: RuntimeXrInputSource): boolean {
    return Boolean(source.selecting || source.gamepad?.buttons[0]?.pressed);
  }

  private updateVrScaleGesture(inputSources: RuntimeXrInputSource[]): boolean {
    if (!this.camera || !this.cameraRoot) return false;

    const left = inputSources.find((source) => source.handedness === 'left' && this.isXrTriggerPressed(source));
    const right = inputSources.find((source) => source.handedness === 'right' && this.isXrTriggerPressed(source));
    const leftPos = left?.getPosition?.()?.clone() ?? null;
    const rightPos = right?.getPosition?.()?.clone() ?? null;
    if (!left || !right || !leftPos || !rightPos) {
      this.vrScaleGesture = null;
      return false;
    }

    const currentDistance = leftPos.distance(rightPos);
    if (!Number.isFinite(currentDistance) || currentDistance <= 0.01) return true;
    const currentMidpoint = leftPos.clone().add(rightPos).mulScalar(0.5);

    if (
      !this.vrScaleGesture ||
      this.vrScaleGesture.leftId !== left.id ||
      this.vrScaleGesture.rightId !== right.id
    ) {
      this.vrScaleGesture = {
        leftId: left.id,
        rightId: right.id,
        initialDistance: currentDistance,
        initialMidpoint: currentMidpoint,
        initialHeadPosition: this.camera.getPosition().clone(),
        initialRootPosition: this.cameraRoot.getPosition().clone(),
      };
      return true;
    }

    const scale = computePinchScale(this.vrScaleGesture.initialDistance, currentDistance);
    const scaledHeadOffset = this.vrScaleGesture.initialHeadPosition
      .clone()
      .sub(this.vrScaleGesture.initialMidpoint)
      .mulScalar(1 / scale);
    const desiredHead = currentMidpoint.clone().add(scaledHeadOffset);
    const rootDelta = desiredHead.sub(this.vrScaleGesture.initialHeadPosition);
    this.cameraRoot.setPosition(this.vrScaleGesture.initialRootPosition.clone().add(rootDelta));
    return true;
  }

  private applyVrMovement(
    stickX: number,
    stickY: number,
    speed: number,
  ): void {
    if (!this.camera || !this.cameraRoot) return;

    // Use camera forward/right projected onto horizontal plane for movement direction
    const forward = this.camera.forward.clone();
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      // Camera is looking straight up/down, fall back to cameraRoot forward
      const rootForward = this.cameraRoot.forward.clone();
      rootForward.y = 0;
      if (rootForward.lengthSq() < 0.0001) return;
      rootForward.normalize();
      forward.copy(rootForward);
    } else {
      forward.normalize();
    }

    const right = this.camera.right.clone();
    right.y = 0;
    right.normalize();

    // stickY: negative = forward (push stick up), positive = backward
    // stickX: positive = right, negative = left
    const moveVec = new Vec3();
    moveVec.add(forward.mulScalar(-stickY * speed));
    moveVec.add(right.mulScalar(stickX * speed));

    // Move the cameraRoot entity
    const pos = this.cameraRoot.getPosition().clone();
    pos.add(moveVec);
    this.cameraRoot.setPosition(pos);
  }

  private onUpdate(dt: number): void {
    const now = performance.now();
    const perfEnabled = this.questPerfEnabled || Boolean(this.options.onQuestPerfSample);
    const updateStart = perfEnabled ? performance.now() : 0;
    let checkpoint = updateStart;
    const buckets: ViewerQuestPerfCpuBuckets = {};
    const markBucket = (key: keyof ViewerQuestPerfCpuBuckets): void => {
      if (!perfEnabled) return;
      const next = performance.now();
      buckets[key] = next - checkpoint;
      checkpoint = next;
    };
    if (this.lastUpdateTime > 0) {
      const delta = now - this.lastUpdateTime;
      if (delta > 0) {
        this.lastFrameTimeMs = delta;
        this.fpsSamples.push(1000 / delta);
        if (this.fpsSamples.length > 90) this.fpsSamples.shift();
        this.frameTimeSamples.push(delta);
        if (this.frameTimeSamples.length > 120) this.frameTimeSamples.shift();
      }
    }
    this.lastUpdateTime = now;

    this.updateAdaptiveQuality(now);
    markBucket('adaptiveQualityMs');
    this.updateRenderPolicy();
    markBucket('renderPolicyMs');

    if (!this.vrActive && this.currentCameraMode === 'orbit') {
      this.updateOrbitAnchorTransition(now);
    }

    // VR locomotion takes priority — use gamepad joysticks
    if (this.vrActive) {
      this.updateVrLocomotion(dt);
      markBucket('vrLocomotionMs');
    } else if (this.currentCameraMode === 'fly') {
      this.updateFlyCamera(dt);
      markBucket('cameraInputMs');
    } else if (this.currentCameraMode === 'orbit') {
      this.updateOrbitPan(dt);
      markBucket('cameraInputMs');
    } else {
      markBucket('cameraInputMs');
    }

    // On the frame immediately after a quality change, skip marker update.
    // PlayCanvas's postUpdate has not yet rebuilt the projection matrix
    // when onUpdate fires, so screen-space positions would be wrong.
    // The deferred update fires in the next frame when projection is ready.
    if (this.pendingQualityMarkerUpdate) {
      this.pendingQualityMarkerUpdate = false;
    } else {
      this.updateMarkerPositions();
    }
    markBucket('markerGizmoMs');

    if (perfEnabled) {
      buckets.totalUpdateMs = performance.now() - updateStart;
      this.lastCpuBuckets = buckets;
      this.options.onQuestPerfSample?.(this.buildStats());
    }
  }

  private updateAdaptiveQuality(now: number): void {
    const profile = this.getCurrentQualityProfile();
    if (!profile.adaptiveQualityEnabled) {
      this.adaptiveQualityScale = 1;
      return;
    }
    if (this.loadPhase === 'loading-metadata' || this.loadPhase === 'loading-asset') return;
    if (this.resolvedAsset.isLod && this.lodLoadingCount > 0) return;
    if (now - this.lastAdaptiveAdjustTime < 2000) return;
    if (this.frameTimeSamples.length < 30) return;
    this.lastAdaptiveAdjustTime = now;

    const avgFrameTime = this.frameTimeSamples.length > 0
      ? this.frameTimeSamples.reduce((a, b) => a + b, 0) / this.frameTimeSamples.length
      : 0;
    const targetFrameTime = 1000 / profile.targetFps;

    if (avgFrameTime > targetFrameTime + 4 && this.adaptiveQualityScale > 0.35) {
      this.adaptiveQualityScale = Math.max(0.35, this.adaptiveQualityScale * 0.85);
      this.applyQualitySettings();
    } else if (avgFrameTime < targetFrameTime - 7 && this.adaptiveQualityScale < 1) {
      this.adaptiveQualityScale = Math.min(1, this.adaptiveQualityScale * 1.08);
      this.applyQualitySettings();
    }
  }

  private updateOrbitPan(dt: number): void {
    if (!this.camera || !this.app?.keyboard) return;
    const keyboard = this.app.keyboard;
    const baseSpeed = keyboard.isPressed(16) ? 8.0 : 4.0;
    const speed = baseSpeed * this.getAnchorProximityMoveScale();
    const cam = this.camera;

    const camForward = cam.forward.clone();
    camForward.y = 0;
    const forward = new Vec3();
    if (camForward.lengthSq() > 0.01) {
      forward.copy(camForward.normalize());
    } else {
      forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }

    const right = cam.right.clone();
    right.y = 0;
    right.normalize();

    const move = new Vec3();
    if (keyboard.isPressed(87)) move.add(forward);
    if (keyboard.isPressed(83)) move.sub(forward);
    if (keyboard.isPressed(68)) move.add(right);
    if (keyboard.isPressed(65)) move.sub(right);
    if (keyboard.isPressed(81)) move.sub(Vec3.UP);
    if (keyboard.isPressed(69)) move.add(Vec3.UP);

    if (move.lengthSq() > 0) {
      move.normalize().mulScalar(speed * dt);
      this.target.add(move);
      this.updateCamera();
    }
  }

  private updateFlyCamera(dt: number): void {
    if (!this.camera || !this.app?.keyboard) return;
    const keyboard = this.app.keyboard;
    const speed = this.flyMoveSpeed;
    const effectiveSpeed = keyboard.isPressed(16) ? speed * 2 : speed;

    const forward = this.camera.forward.clone();
    const right = this.camera.right.clone();
    const worldUp = Vec3.UP;

    const move = new Vec3();
    if (keyboard.isPressed(87)) move.add(forward);
    if (keyboard.isPressed(83)) move.sub(forward);
    if (keyboard.isPressed(68)) move.add(right);
    if (keyboard.isPressed(65)) move.sub(right);
    if (keyboard.isPressed(81)) move.sub(worldUp);    // Q = descend
    if (keyboard.isPressed(69)) move.add(worldUp);    // E = ascend
    if (this.flyMoveJoystick.x !== 0 || this.flyMoveJoystick.y !== 0) {
      move.add(right.clone().mulScalar(this.flyMoveJoystick.x * 0.78));
      move.add(forward.clone().mulScalar(-this.flyMoveJoystick.y * 0.78));
    }

    if (move.lengthSq() > 0) {
      move.normalize().mulScalar(effectiveSpeed * dt);
      const pos = this.camera.getPosition().clone();
      pos.add(move);
      this.camera.setPosition(pos.x, pos.y, pos.z);
    }

    if (this.flyLookJoystick.x !== 0 || this.flyLookJoystick.y !== 0) {
      this.flyYaw -= this.flyLookJoystick.x * dt * 1.9;
      this.flyPitch = Math.max(-1.5, Math.min(1.5, this.flyPitch - this.flyLookJoystick.y * dt * 1.65));
    }

    // Apply fly rotation from mouse look
    const cosP = Math.cos(this.flyPitch);
    const lookDir = new Vec3(
      Math.sin(this.flyYaw) * cosP,
      Math.sin(this.flyPitch),
      Math.cos(this.flyYaw) * cosP,
    );
    const lookTarget = this.camera.getPosition().clone().add(lookDir);
    this.camera.lookAt(lookTarget);
  }

  private isCoarsePointer(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  }

  private createFlyJoysticks(): void {
    if (this.flyJoystickLayer || !this.canvas.parentElement) return;

    const layer = document.createElement('div');
    layer.className = 'gsplat-fly-joysticks';
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = '6';

    const left = this.createJoystickElement('Move');
    left.style.left = '18px';
    left.style.bottom = '18px';
    const right = this.createJoystickElement('Look');
    right.style.right = '18px';
    right.style.bottom = '18px';

    this.bindJoystick(left, this.flyMoveJoystick);
    this.bindJoystick(right, this.flyLookJoystick);
    layer.append(left, right);
    this.canvas.parentElement.appendChild(layer);
    this.flyJoystickLayer = layer;
  }

  private createJoystickElement(label: string): HTMLDivElement {
    const base = document.createElement('div');
    base.setAttribute('aria-label', `${label} joystick`);
    base.style.position = 'absolute';
    base.style.width = '104px';
    base.style.height = '104px';
    base.style.borderRadius = '50%';
    base.style.background = 'rgba(245,245,245,0.12)';
    base.style.border = '1px solid rgba(255,255,255,0.22)';
    base.style.backdropFilter = 'blur(8px)';
    base.style.pointerEvents = 'auto';
    base.style.touchAction = 'none';
    base.style.opacity = '0.55';

    const knob = document.createElement('div');
    knob.dataset.knob = 'true';
    knob.style.position = 'absolute';
    knob.style.left = '50%';
    knob.style.top = '50%';
    knob.style.width = '42px';
    knob.style.height = '42px';
    knob.style.borderRadius = '50%';
    knob.style.background = 'rgba(245,245,245,0.34)';
    knob.style.border = '1px solid rgba(255,255,255,0.28)';
    knob.style.transform = 'translate(-50%, -50%)';
    knob.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
    base.appendChild(knob);
    return base;
  }

  private bindJoystick(base: HTMLDivElement, state: VirtualJoystickState): void {
    const update = (event: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const max = Math.max(1, rect.width * 0.34);
      const dx = Math.max(-max, Math.min(max, event.clientX - (rect.left + rect.width * 0.5)));
      const dy = Math.max(-max, Math.min(max, event.clientY - (rect.top + rect.height * 0.5)));
      state.x = applyDeadzone(dx / max, 0.12);
      state.y = applyDeadzone(dy / max, 0.12);
      const knob = base.querySelector<HTMLElement>('[data-knob="true"]');
      if (knob) {
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
      base.style.opacity = '0.82';
      this.requestRender();
    };

    const reset = (event: PointerEvent) => {
      if (state.pointerId !== event.pointerId) return;
      state.pointerId = null;
      state.x = 0;
      state.y = 0;
      const knob = base.querySelector<HTMLElement>('[data-knob="true"]');
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
      base.style.opacity = '0.55';
      this.requestRender();
    };

    base.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      state.pointerId = event.pointerId;
      base.setPointerCapture?.(event.pointerId);
      update(event);
    });
    base.addEventListener('pointermove', (event) => {
      if (state.pointerId === event.pointerId) update(event);
    });
    base.addEventListener('pointerup', reset);
    base.addEventListener('pointercancel', reset);
  }

  private removeFlyJoysticks(): void {
    this.flyJoystickLayer?.remove();
    this.flyJoystickLayer = null;
    this.flyMoveJoystick = { pointerId: null, x: 0, y: 0 };
    this.flyLookJoystick = { pointerId: null, x: 0, y: 0 };
  }

  private updateCamera(): void {
    if (!this.camera) return;
    if (this.currentCameraMode === 'fly') {
      // In fly mode, updateCamera is only called by setCameraMode to initialize position
      // The fly camera is handled by updateFlyCamera each frame
      return;
    }
    const cosPitch = Math.cos(this.pitch);
    const x = this.target.x + Math.sin(this.yaw) * cosPitch * this.distance;
    const y = this.target.y + Math.sin(this.pitch) * this.distance;
    const z = this.target.z + Math.cos(this.yaw) * cosPitch * this.distance;
    this.camera.setPosition(x, y, z);
    this.camera.lookAt(this.target);
    this.app && (this.app.renderNextFrame = true);
  }

  private updateMarkerPositions(): void {
    if (this.vrActive) {
      this.setOverlayHiddenForVr(true);
      return;
    }
    this.setOverlayHiddenForVr(false);

    if (!this.camera?.camera) {
      this.updateOrbitAnchorGizmo();
      return;
    }
    if (!this.markerLayer || this.markerButtons.size === 0) {
      this.updateOrbitAnchorGizmo();
      return;
    }

    // PlayCanvas CameraComponent.worldToScreen passes device.clientRect
    // (CSS layout dimensions from getBoundingClientRect) as cw/ch to the
    // underlying Camera.worldToScreen. The output coordinates are therefore
    // in CSS layout pixel space — NOT canvas buffer pixel space.
    //
    // Previously the code computed scaleX/scaleY = CSS / buffer and
    // multiplied, which double-converted: markers ended up at
    //   screenCSS * (CSS / buffer) instead of just screenCSS.
    // This was invisible when buffer ≈ CSS (Medium/High on DPR-1 devices,
    // where maxDevicePixelRatio ≥ 1 → ratio ≈ 1 → scaleX ≈ 1), but
    // Low's maxDevicePixelRatio 0.75 makes buffer < CSS → scaleX > 1 →
    // markers amplify away from center.
    const canvasRect = this.canvas.getBoundingClientRect();
    const tmp = new Vec3();

    for (const point of this.markers) {
      const button = this.markerButtons.get(point.id);
      if (!button) continue;
      const screen = this.camera.camera.worldToScreen(
        new Vec3(point.position[0], point.position[1], point.position[2]),
        tmp,
      );
      // Visibility bounds must use CSS dimensions (same coordinate space
      // as worldToScreen output), not canvas buffer dimensions.
      const visible = screen.z > 0 && screen.x >= -64 && screen.y >= -64 && screen.x <= canvasRect.width + 64 && screen.y <= canvasRect.height + 64;
      button.style.display = visible ? 'flex' : 'none';
      if (visible) {
        // worldToScreen output is already in CSS layout pixel space;
        // the marker layer (position:absolute, inset:0) is aligned with
        // the canvas CSS box, so coordinates map directly.
        button.style.left = `${screen.x}px`;
        button.style.top = `${screen.y}px`;
      }
    }
    this.updateOrbitAnchorGizmo();
  }

  private setOverlayHiddenForVr(hidden: boolean): void {
    if (hidden) {
      if (this.markerLayer) this.markerLayer.style.display = 'none';
    } else {
      this.updateMarkerLayerVisibility();
    }
    if (this.orbitAnchorGizmo && hidden) {
      this.orbitAnchorGizmo.style.display = 'none';
    }
  }

  private updateMarkerLayerVisibility(): void {
    const hidden = this.vrActive || this.options.showMarkers === false || this.questPerfOverrides.markersVisible === false;
    if (this.markerLayer) {
      this.markerLayer.style.display = hidden ? 'none' : '';
    }
    if (this.orbitAnchorGizmo && this.questPerfOverrides.markersVisible === false) {
      this.orbitAnchorGizmo.style.display = 'none';
    }
  }

  private updateOrbitAnchorGizmo(): void {
    if (!this.orbitAnchorGizmo || !this.camera?.camera) return;
    if (this.currentCameraMode !== 'orbit' || this.vrActive || this.questPerfOverrides.markersVisible === false) {
      this.orbitAnchorGizmo.style.display = 'none';
      return;
    }

    const canvasRect = this.canvas.getBoundingClientRect();
    const screen = this.camera.camera.worldToScreen(this.target, new Vec3());
    const visible = screen.z > 0 &&
      screen.x >= -20 &&
      screen.y >= -20 &&
      screen.x <= canvasRect.width + 20 &&
      screen.y <= canvasRect.height + 20;

    this.orbitAnchorGizmo.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.orbitAnchorGizmo.style.left = `${screen.x}px`;
      this.orbitAnchorGizmo.style.top = `${screen.y}px`;
    }
  }

  private requestRender(): void {
    if (this.app) {
      this.app.renderNextFrame = true;
    }
  }

  private updateRenderPolicy(): void {
    if (!this.app) return;
    // Always keep the render loop alive. Stopping autoRender and restarting
    // on interaction causes a cold-start GPU pipeline penalty (shader
    // recompilation, GPU clock ramp-up, driver state revalidation) that
    // manifests as a visible frame drop. PlayCanvas's own rAF loop naturally
    // throttles when nothing changes, so keeping autoRender=true has
    // negligible power cost while eliminating the stutter.
    if (!this.app.autoRender) {
      this.app.autoRender = true;
      this.requestRender();
    }
  }

  private applyQualitySettings(): void {
    if (!this.app) return;
    const profile = this.getCurrentQualityProfile();
    const settings = this.getEffectiveQualitySettings(profile);
    this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, settings.maxDevicePixelRatio);
    if (this.camera?.camera) {
      this.camera.camera.nearClip = settings.nearClip;
    }
    this.applyGsplatSettings();
    this.resize();
    // resize() synchronously updates camera.aspectRatio and sets buffer
    // dimensions via graphicsDevice.setResolution (without overriding
    // CSS sizing). Marker positions in updateMarkerPositions() use
    // worldToScreen output (CSS-space) directly — no buffer/CSS scaling.
    this.updateRenderPolicy();
  }

  private onGsplatSorted(sortTimeMs: number): void {
    if (Number.isFinite(sortTimeMs)) {
      this.lastSortTimeMs = sortTimeMs;
    }
  }

  private onGsplatFrameReady(_camera: unknown, _layer: unknown, ready: boolean, loadingCount: number): void {
    this.lodLoadingCount = Math.max(0, loadingCount || 0);
    this.updateRenderPolicy();
    if (!this.resolvedAsset.isLod || this.loadPhase === 'idle' || this.loadPhase === 'loading-metadata' || this.loadPhase === 'loading-asset') {
      return;
    }
    if (ready && this.lodLoadingCount === 0 && this.loadPhase !== 'complete') {
      this.emitProgress('complete', 'LOD refinement complete', undefined, undefined, this.resolvedAsset.url);
    } else if (this.lodLoadingCount > 0 && this.loadPhase !== 'refining') {
      this.emitProgress('refining', 'Streaming LOD refinement', undefined, undefined, this.resolvedAsset.url);
    }
  }

  private emitProgress(
    phase: ViewerLoadPhase,
    message?: string,
    loadedBytes?: number,
    totalBytes?: number,
    assetUrl?: string,
  ): void {
    this.loadPhase = phase;
    this.options.onProgress?.({
      phase,
      message,
      loadedBytes,
      totalBytes,
      assetUrl,
      assetFormat: this.resolvedAsset.format,
    });
  }

  private emitStats(): void {
    const start = performance.now();
    const stats = this.buildStats();
    if (this.questPerfEnabled) {
      stats.cpu = {
        ...stats.cpu,
        statsEmitMs: performance.now() - start,
      };
    }
    this.options.onStats?.(stats);
  }

  private readCameraPose(): ViewerStats['camera'] {
    if (!this.camera) return undefined;
    const position = this.camera.getPosition();
    return {
      position: [position.x, position.y, position.z],
      target: [this.target.x, this.target.y, this.target.z],
    };
  }

  private buildStats(): ViewerStats {
    const profile = this.getCurrentQualityProfile();
    const settings = this.getEffectiveQualitySettings(profile);
    const avgFps = this.fpsSamples.length
      ? this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length
      : 0;
    const percentiles = computeQuestPerfPercentiles(this.frameTimeSamples);
    const frameStats = (this.app?.stats as { frame?: { gsplats?: number } } | undefined)?.frame;
    const actualRenderedSplats = typeof frameStats?.gsplats === 'number' ? frameStats.gsplats : undefined;
    const gsplat = this.app?.scene.gsplat as { currentRenderer?: unknown } | undefined;
    const xr = this.app?.xr as RuntimeXrManagerLike | undefined;
    const totalSplats = this.loadedSplats || this.manifestHasCount();
    const memory = readPerformanceMemory();
    const gpuTimerStatus = this.questPerfEnabled
      ? this.gpuTimer?.status ?? (this.rendererMode === 'webgl2' ? 'unsupported' : 'n/a')
      : 'disabled';
    const cameraPose = this.readCameraPose();
    const qualityFlags: ViewerQuestPerfQualityFlags = {
      antialias: settings.antialias,
      highQualitySH: settings.highQualitySH,
      radialSorting: settings.radialSorting,
      renderOnDemand: settings.renderOnDemand,
      markersVisible: this.options.showMarkers !== false && this.questPerfOverrides.markersVisible !== false && !this.vrActive,
    };
    const stats: ViewerStats = {
      fps: Math.round(avgFps),
      rendererMode: this.rendererMode,
      gsplatRenderer: gsplat?.currentRenderer !== undefined ? String(gsplat.currentRenderer) : undefined,
      rendererBackend: 'playcanvas',
      rendererPipeline: this.rendererPipeline,
      quality: this.currentQuality,
      splatBudget: settings.splatBudget,
      approximateLoadedSplats: totalSplats,
      totalSplats,
      activeSplats: actualRenderedSplats ?? totalSplats,
      actualRenderedSplats,
      sortTimeMs: this.lastSortTimeMs,
      frameP50Ms: percentiles.p50,
      frameP95Ms: percentiles.p95,
      frameP99Ms: percentiles.p99,
      cpu: this.questPerfEnabled ? this.lastCpuBuckets : undefined,
      gpuTimeMs: this.questPerfEnabled ? this.gpuTimer?.lastTimeMs : undefined,
      gpuTimerStatus,
      frameTimeMs: this.lastFrameTimeMs,
      canvasPixels: this.canvas.width * this.canvas.height,
      devicePixelRatio: this.canvas.width / Math.max(1, this.canvas.clientWidth),
      jsHeapUsedMB: memory?.usedMB,
      jsHeapTotalMB: memory?.totalMB,
      minPixelSize: settings.minPixelSize,
      minContribution: settings.minContribution,
      alphaClip: settings.alphaClip,
      lodBaseDistance: settings.lodBaseDistance,
      lodMultiplier: settings.lodMultiplier,
      lodRange: settings.lodRange,
      adaptiveQualityScale: this.adaptiveQualityScale,
      renderOnDemand: settings.renderOnDemand,
      loadPhase: this.loadPhase,
      lodActive: this.resolvedAsset.isLod || this.lodLoadingCount > 0,
      assetFormat: this.resolvedAsset.format,
      assetUrl: this.resolvedAsset.url,
      activeAssetVariant: this.resolvedAsset.variantName,
      isSog: this.resolvedAsset.isSog,
      xrActive: this.vrActive,
      xrFrameRate: xr?.frameRate,
      xrFramebufferScale: this.activeXrFramebufferScale,
      fixedFoveation: xr?.fixedFoveation ?? this.activeXrFixedFoveation,
      lodLoadingCount: this.lodLoadingCount,
      camera: cameraPose,
      qualityFlags,
    };
    return stats;
  }

  private manifestHasCount(): number {
    const count = (this.manifest as unknown as { splatCount?: number }).splatCount;
    if (typeof count === 'number' && Number.isFinite(count)) return count;
    return 0;
  }
}
