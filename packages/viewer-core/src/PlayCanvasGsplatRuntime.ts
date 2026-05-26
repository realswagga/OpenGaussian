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
  GSPLAT_RENDERER_RASTER_CPU_SORT,
  GSPLAT_RENDERER_RASTER_GPU_SORT,
  Keyboard,
  LightComponentSystem,
  Mouse,
  RenderComponentSystem,
  ScriptComponentSystem,
  TextureHandler,
  TouchDevice,
  Vec3,
  XRSPACE_LOCALFLOOR,
  XRTYPE_VR,
  XrManager,
  platform,
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
} from './types.js';
import { chooseRendererMode, detectDeviceProfile, qualityProfiles, resolveViewerAsset } from './types.js';

type RendererBackend = 'webgl2' | 'webgpu';

interface RuntimeAppOptions {
  graphicsDevice: GraphicsDevice;
  mouse: Mouse;
  touch: TouchDevice;
  keyboard: Keyboard;
}

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
  if (quality === 'ultra') return qualityProfiles.desktopHigh;
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

export class PlayCanvasGsplatRuntime implements ViewerRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly manifest: ViewerManifest;
  private readonly options: ViewerOptions;
  private readonly resolvedAsset: ResolvedViewerAsset;

  private markers: MarkerPoint[];
  private currentQuality: QualityPreset;
  private currentCameraMode: CameraMode;
  private rendererMode: RendererBackend = 'webgl2';
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

  private yaw = 0;
  private pitch = -0.2;
  private distance = 4;
  private target = new Vec3(0, 0.3, 0);
  private isDragging = false;
  private isRightDrag = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private fpsSamples: number[] = [];
  private lastUpdateTime = 0;
  private loadedSplats = 0;
  private destroyed = false;
  // Fly mode state
  private flyYaw = 0;
  private flyPitch = 0;

  constructor(options: ViewerOptions) {
    this.canvas = options.canvas;
    this.manifest = options.manifest;
    this.options = options;
    this.markers = options.markers || options.annotations || [];
    this.currentQuality = options.quality || this.manifest.viewer.quality || 'auto';
    this.currentCameraMode = options.cameraMode || (options.locked ? 'locked' : 'orbit');
    this.resolvedAsset = resolveViewerAsset(this.manifest);
  }

  async start(): Promise<void> {
    if (this.app) return;
    this.destroyed = false;
    this.setupCanvas();
    this.emitProgress('loading-metadata', 'Preparing PlayCanvas GSplat runtime');

    const requested = this.options.rendererMode || 'auto';
    // When VR is enabled, force WebGL2 so the graphics device can be created
    // with xrCompatible: true.  This follows the project rule: "VR requested
    // or active -> prefer stable WebGL2 path".
    const vrEnabled = this.manifest.viewer.enableVr !== false;
    this.rendererMode = chooseRendererMode({
      requested,
      isVrRequested: vrEnabled,
      webgpuSupported: isWebGPUAvailable(),
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
    this.markerButtons.clear();
    this.selectedMarkerId = null;
    this.splatAsset = null;
    this.splatEntity = null;
    this.camera = null;
    this.cameraRoot = null;
    this.app?.destroy();
    this.app = null;
  }

  setQuality(quality: QualityPreset): void {
    this.currentQuality = quality;
    this.applyQualitySettings();
  }

  setCameraMode(mode: CameraMode): void {
    this.currentCameraMode = mode;
    if (mode === 'fly') {
      // Initialize fly orientation from current camera
      if (this.camera) {
        this.flyYaw = this.yaw;
        this.flyPitch = this.pitch;
      }
      this.canvas.style.cursor = 'none';
    } else if (mode === 'locked') {
      this.canvas.style.cursor = 'default';
      document.exitPointerLock();
    } else {
      this.canvas.style.cursor = 'grab';
      document.exitPointerLock();
    }
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
    this.updateMarkerPositions();
  }

  /** @deprecated Use setMarkers. */
  setAnnotations(points: MarkerPoint[]): void {
    this.setMarkers(points);
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
        this.app!.xr!.start(this.camera!.camera!, XRTYPE_VR, XRSPACE_LOCALFLOOR, {
          callback: (error?: Error | null) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          },
        });
      } catch (syncError) {
        reject(syncError instanceof Error ? syncError : new Error(String(syncError)));
      }
    });
  }

  async exitVr(): Promise<void> {
    if (this.app?.xr?.active) {
      this.app.xr.end();
    }
  }

  private async createApp(rendererMode: RendererBackend): Promise<void> {
    const profile = qualityForPreset(this.currentQuality);
    const deviceTypes = rendererMode === 'webgpu' ? ['webgpu', 'webgl2'] : ['webgl2'];
    const vrRequested = this.manifest.viewer.enableVr !== false;
    const device = await createGraphicsDevice(this.canvas, {
      deviceTypes,
      antialias: profile.antialias,
      depth: true,
      stencil: false,
      xrCompatible: rendererMode !== 'webgpu',
      powerPreference: 'high-performance',
    });
    // When VR is enabled, lock to WebGL2 regardless of what the graphics
    // device reports. Some PlayCanvas/browser builds may report 'webgpu'
    // even when deviceTypes is restricted to ['webgl2'].
    this.rendererMode = vrRequested
      ? 'webgl2'
      : (device.deviceType === 'webgpu' ? 'webgpu' : 'webgl2');
    device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxDevicePixelRatio);

    this.app = new GsplatApp(this.canvas, {
      graphicsDevice: device,
      mouse: new Mouse(this.canvas),
      touch: new TouchDevice(this.canvas),
      keyboard: new Keyboard(window),
    });
  }

  private configureScene(): void {
    if (!this.app) return;
    this.app.scene.ambientLight = new Color(0.51, 0.55, 0.65);
    this.app.scene.on('gsplat:sorted', this.onGsplatSorted, this);
    this.app.systems.gsplat?.on('frame:ready', this.onGsplatFrameReady, this);
    this.applyGsplatSettings();
  }

  private createCamera(): void {
    this.cameraRoot = new Entity('camera-root');
    this.camera = new Entity('camera');
    this.cameraRoot.addChild(this.camera);
    this.app!.root.addChild(this.cameraRoot);

    this.camera.addComponent('camera', {
      clearColor: new Color(0.02, 0.02, 0.02),
      nearClip: 0.03,
      farClip: 1000,
      fov: 60,
    });

    const defaultCamera = this.manifest.viewer.defaultCamera as { position?: [number, number, number]; target?: [number, number, number]; fov?: number } | undefined;
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
        this.splatEntity = new Entity('gsplat');
        this.splatEntity.addComponent('gsplat', {
          unified: true,
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

        this.applyGsplatSettings();
        this.loadedSplats = readPossibleCount(asset.resource) || readPossibleCount(asset) || this.manifestHasCount();
        this.emitProgress('renderable', 'First renderable splat frame is available', undefined, undefined, this.resolvedAsset.url);
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

  private applyGsplatSettings(): void {
    if (!this.app) return;
    const profile = qualityForPreset(this.currentQuality);
    const gsplat = this.app.scene.gsplat;
    gsplat.antiAlias = profile.antialias;
    gsplat.alphaClip = 1 / 255;
    gsplat.splatBudget = profile.splatBudget;
    gsplat.debug = GSPLAT_DEBUG_NONE;
    gsplat.renderer = this.rendererMode === 'webgpu'
      ? GSPLAT_RENDERER_RASTER_GPU_SORT
      : GSPLAT_RENDERER_RASTER_CPU_SORT;
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
  }

  private setupResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.app?.on('update', this.onUpdate, this);
    this.resize();
  }

  private resize(): void {
    if (!this.app || this.app.xr?.active) return;
    const profile = qualityForPreset(this.currentQuality);
    const maxPixelDim = platform.mobile ? 1080 : 2160;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const screenMin = Math.max(1, Math.min(window.screen?.width || width, window.screen?.height || height));
    const ratio = Math.min(maxPixelDim / screenMin, window.devicePixelRatio || 1, profile.maxDevicePixelRatio);
    this.canvas.width = Math.ceil(width * ratio);
    this.canvas.height = Math.ceil(height * ratio);
    this.app.resizeCanvas(this.canvas.width, this.canvas.height);
    this.app.renderNextFrame = true;
  }

  private setupInput(): void {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Pointer lock change handler for fly mode
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private removeInput(): void {
    this.canvas.removeEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.exitPointerLock();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.currentCameraMode === 'locked') return;

    if (this.currentCameraMode === 'fly') {
      this.canvas.requestPointerLock();
      return;
    }

    // Left click = orbit, right click = pan
    this.isDragging = true;
    this.isRightDrag = event.button === 2;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.canvas.style.cursor = this.isRightDrag ? 'grabbing' : 'grabbing';
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || this.currentCameraMode === 'locked' || this.currentCameraMode === 'fly') return;

    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    if (this.isRightDrag) {
      // Right-drag: pan the target
      if (!this.camera) return;
      const right = this.camera.right.clone();
      const up = this.camera.up.clone();
      right.normalize();
      up.normalize();
      const d = Math.max(0.1, this.distance);
      const panSpeed = d * 0.003;
      this.target.sub(right.mulScalar(dx * panSpeed));
      this.target.add(up.mulScalar(dy * panSpeed));
      this.updateCamera();
    } else {
      // Left-drag: orbit
      this.yaw -= dx * 0.006;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.004));
      this.updateCamera();
    }
  };

  private onPointerUp = (): void => {
    this.isDragging = false;
    this.isRightDrag = false;
    this.canvas.style.cursor = this.currentCameraMode === 'locked' ? 'default' : this.currentCameraMode === 'fly' ? 'none' : 'grab';
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.currentCameraMode === 'locked') return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.1 : 0.9;
    this.distance = Math.max(0.2, Math.min(200, this.distance * factor));
    this.updateCamera();
  };

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked && this.currentCameraMode === 'fly') {
      document.addEventListener('mousemove', this.onFlyMouseMove);
      this.canvas.style.cursor = 'none';
    } else {
      document.removeEventListener('mousemove', this.onFlyMouseMove);
      this.canvas.style.cursor = this.currentCameraMode === 'locked' ? 'default' : 'grab';
    }
  };

  private onFlyMouseMove = (event: MouseEvent): void => {
    if (this.currentCameraMode !== 'fly') return;
    const dx = event.movementX;
    const dy = event.movementY;
    this.flyYaw -= dx * 0.003;
    this.flyPitch = Math.max(-1.5, Math.min(1.5, this.flyPitch - dy * 0.003));
  };

  private onUpdate(dt: number): void {
    const now = performance.now();
    if (this.lastUpdateTime > 0) {
      const delta = now - this.lastUpdateTime;
      if (delta > 0) {
        this.fpsSamples.push(1000 / delta);
        if (this.fpsSamples.length > 90) this.fpsSamples.shift();
      }
    }
    this.lastUpdateTime = now;
    if (this.currentCameraMode === 'fly') {
      this.updateFlyCamera(dt);
    } else if (this.currentCameraMode === 'orbit') {
      this.updateOrbitPan(dt);
    }
    this.updateMarkerPositions();
  }

  private updateOrbitPan(dt: number): void {
    if (!this.camera || !this.app?.keyboard) return;
    const keyboard = this.app.keyboard;
    const speed = 4.0;
    const cam = this.camera;

    const forward = cam.forward.clone();
    forward.y = 0;
    forward.normalize();

    const right = cam.right.clone();
    right.y = 0;
    right.normalize();

    const move = new Vec3();
    if (keyboard.isPressed(87)) move.add(forward);
    if (keyboard.isPressed(83)) move.sub(forward);
    if (keyboard.isPressed(68)) move.add(right);
    if (keyboard.isPressed(65)) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().mulScalar(speed * dt);
      this.target.add(move);
      this.updateCamera();
    }
  }

  private updateFlyCamera(dt: number): void {
    if (!this.camera || !this.app?.keyboard) return;
    const keyboard = this.app.keyboard;
    const speed = 4.0;
    // Speed boost with Shift
    const effectiveSpeed = keyboard.isPressed(16) ? speed * 3 : speed;

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

    if (move.lengthSq() > 0) {
      move.normalize().mulScalar(effectiveSpeed * dt);
      const pos = this.camera.getPosition().clone();
      pos.add(move);
      this.camera.setPosition(pos.x, pos.y, pos.z);
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
    if (!this.camera?.camera || !this.markerLayer || this.markerButtons.size === 0) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / Math.max(1, this.canvas.width);
    const scaleY = canvasRect.height / Math.max(1, this.canvas.height);
    const tmp = new Vec3();

    for (const point of this.markers) {
      const button = this.markerButtons.get(point.id);
      if (!button) continue;
      const screen = this.camera.camera.worldToScreen(
        new Vec3(point.position[0], point.position[1], point.position[2]),
        tmp,
      );
      const visible = screen.z > 0 && screen.x >= -64 && screen.y >= -64 && screen.x <= this.canvas.width + 64 && screen.y <= this.canvas.height + 64;
      button.style.display = visible ? 'flex' : 'none';
      if (visible) {
        button.style.left = `${screen.x * scaleX}px`;
        button.style.top = `${screen.y * scaleY}px`;
      }
    }
  }

  private applyQualitySettings(): void {
    if (!this.app) return;
    const profile = qualityForPreset(this.currentQuality);
    this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxDevicePixelRatio);
    this.applyGsplatSettings();
    this.resize();
  }

  private onGsplatSorted(sortTimeMs: number): void {
    if (Number.isFinite(sortTimeMs)) {
      this.lastSortTimeMs = sortTimeMs;
    }
  }

  private onGsplatFrameReady(_camera: unknown, _layer: unknown, ready: boolean, loadingCount: number): void {
    this.lodLoadingCount = Math.max(0, loadingCount || 0);
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
    const profile = qualityForPreset(this.currentQuality);
    const avgFps = this.fpsSamples.length
      ? this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length
      : 0;
    const stats: ViewerStats = {
      fps: Math.round(avgFps),
      rendererMode: this.rendererMode,
      rendererBackend: 'playcanvas',
      quality: this.currentQuality,
      splatBudget: profile.splatBudget,
      approximateLoadedSplats: this.loadedSplats || this.manifestHasCount(),
      totalSplats: this.loadedSplats || this.manifestHasCount(),
      activeSplats: this.resolvedAsset.isLod
        ? Math.min(this.loadedSplats || this.manifestHasCount(), profile.splatBudget)
        : this.loadedSplats || this.manifestHasCount(),
      sortTimeMs: this.lastSortTimeMs,
      canvasPixels: this.canvas.width * this.canvas.height,
      loadPhase: this.loadPhase,
      lodActive: this.resolvedAsset.isLod || this.lodLoadingCount > 0,
      assetFormat: this.resolvedAsset.format,
      assetUrl: this.resolvedAsset.url,
      isSog: this.resolvedAsset.isSog,
    };
    this.options.onStats?.(stats);
  }

  private manifestHasCount(): number {
    const count = (this.manifest as unknown as { splatCount?: number }).splatCount;
    if (typeof count === 'number' && Number.isFinite(count)) return count;
    return 0;
  }
}
