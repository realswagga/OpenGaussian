import { GsplatViewer } from '@gsplat/viewer-core';
import type { QualityPreset, MarkerPoint, ViewerStats, RendererMode, CameraMode, ViewerRuntimeProgress } from '@gsplat/viewer-core';

interface WidgetConfig {
  scene: {
    slug: string;
    manifestUrl: string;
    markersUrl?: string;
    annotationsUrl: string;
  };
  widget: {
    locked: boolean;
    showMarkers: boolean;
    showUi: string;
    enableVr: boolean;
    quality: QualityPreset;
  };
}

class GsViewerElement extends HTMLElement {
  private viewer: GsplatViewer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot;
  private selectedMarker: MarkerPoint | null = null;
  private infoPanel: HTMLDivElement | null = null;
  private controlsBar: HTMLDivElement | null = null;
  private loadingEl: HTMLDivElement | null = null;
  private currentQuality: QualityPreset = 'auto';
  private currentCameraMode: CameraMode = 'orbit';

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes(): string[] {
    return ['scene', 'height', 'quality', 'show-markers', 'vr', 'locked', 'ui', 'renderer', 'budget', 'nofx'];
  }

  connectedCallback(): void {
    this.init();
    this.loadConfig();
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  attributeChangedCallback(): void {
    if (this.container) {
      this.destroy();
      this.init();
      this.loadConfig();
    }
  }

  private init(): void {
    const styles = document.createElement('style');
    styles.textContent = `
      :host {
        display: block;
        background: #050505;
        position: relative;
        overflow: hidden;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .container {
        width: 100%;
        height: 100%;
        position: relative;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .controls {
        position: absolute;
        bottom: 12px;
        left: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        z-index: 10;
      }
      .controls button {
        background: rgba(17, 17, 17, 0.85);
        border: 1px solid #2a2a2a;
        color: #f5f5f5;
        padding: 5px 10px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        backdrop-filter: blur(8px);
      }
      .controls button:hover { background: rgba(23, 23, 23, 0.9); }
      .controls button.active { background: #f5f5f5; color: #050505; }
      .info-panel {
        position: absolute;
        bottom: 12px;
        right: 12px;
        background: rgba(17, 17, 17, 0.9);
        border: 1px solid #2a2a2a;
        border-radius: 8px;
        padding: 12px 16px;
        max-width: 260px;
        backdrop-filter: blur(8px);
        color: #f5f5f5;
        z-index: 10;
        display: none;
      }
      .info-panel.open { display: block; }
      .info-panel h4 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
      .info-panel p { margin: 0; font-size: 12px; color: #a3a3a3; }
      .info-panel .close-btn {
        position: absolute;
        top: 4px;
        right: 8px;
        background: none;
        border: none;
        color: #a3a3a3;
        cursor: pointer;
        font-size: 16px;
      }
      .loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #a3a3a3;
        font-size: 14px;
        z-index: 5;
      }
      .error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ef4444;
        font-size: 14px;
        z-index: 5;
        text-align: center;
        padding: 20px;
      }
    `;
    this.shadow.appendChild(styles);

    this.container = document.createElement('div');
    this.container.className = 'container';
    this.container.style.height = this.getAttribute('height') || '480px';
    this.shadow.appendChild(this.container);

    // Loading indicator
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Loading...';
    this.container.appendChild(loading);

    // Canvas
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    // Controls bar
    this.controlsBar = document.createElement('div');
    this.controlsBar.className = 'controls';
    this.container.appendChild(this.controlsBar);
    this.buildControls();

    this.loadingEl = loading;
  }

  private buildControls(): void {
    if (!this.controlsBar) return;
    this.controlsBar.innerHTML = '';

    const showUi = this.getAttribute('ui') || 'minimal';

    if (showUi === 'hidden') return;

    const qualityBtn = document.createElement('button');
    qualityBtn.textContent = `Quality: ${this.currentQuality}`;
    qualityBtn.addEventListener('click', () => {
      const qualities: QualityPreset[] = ['auto', 'low', 'medium', 'high'];
      const currentIndex = qualities.indexOf(this.currentQuality);
      this.currentQuality = qualities[(currentIndex + 1) % qualities.length] || 'auto';
      this.viewer?.setQuality(this.currentQuality);
      qualityBtn.textContent = `Quality: ${this.currentQuality}`;
      this.dispatchEvent(new CustomEvent('quality-change', { detail: { quality: this.currentQuality } }));
    });
    this.controlsBar.appendChild(qualityBtn);

    if (this.getAttribute('locked') !== 'true') {
      const orbitBtn = document.createElement('button');
      orbitBtn.textContent = 'Orbit';
      orbitBtn.addEventListener('click', () => {
        this.currentCameraMode = 'orbit';
        this.viewer?.setCameraMode('orbit');
      });
      this.controlsBar.appendChild(orbitBtn);

      const flyBtn = document.createElement('button');
      flyBtn.textContent = 'Fly';
      flyBtn.addEventListener('click', () => {
        this.currentCameraMode = 'fly';
        this.viewer?.setCameraMode('fly');
      });
      this.controlsBar.appendChild(flyBtn);
    }

    if (showUi === 'full') {
      const vrBtn = document.createElement('button');
      vrBtn.textContent = 'VR';
      vrBtn.addEventListener('click', () => this.viewer?.enterVr());
      this.controlsBar.appendChild(vrBtn);
    }
  }

  private async loadConfig(): Promise<void> {
    const sceneSlug = this.getAttribute('scene');
    if (!sceneSlug) {
      this.showError('No scene specified. Use scene="slug" attribute.');
      return;
    }

    try {
      const configUrl = `/api/widget/${encodeURIComponent(sceneSlug)}/config`;
      const response = await fetch(configUrl);
      if (!response.ok) throw new Error(`Config fetch failed: ${response.status}`);
      const config: WidgetConfig = await response.json();

      const manifestResponse = await fetch(config.scene.manifestUrl);
      if (!manifestResponse.ok) throw new Error(`Manifest fetch failed: ${manifestResponse.status}`);
      const manifest = await manifestResponse.json();

      let markers: MarkerPoint[] = [];
      try {
        const markerResponse = await fetch(config.scene.markersUrl || config.scene.annotationsUrl);
        if (markerResponse.ok) {
          const markerData = await markerResponse.json();
          markers = markerData.items || [];
        }
      } catch {
        // Markers optional
      }

      this.initViewer(manifest, markers, config);
    } catch (err) {
      this.showError(err instanceof Error ? err.message : 'Failed to load scene');
    }
  }

  private initViewer(manifest: unknown, markers: MarkerPoint[], config: WidgetConfig): void {
    if (!this.canvas || !this.container || !this.loadingEl) return;

    this.loadingEl.style.display = 'flex';
    this.loadingEl.textContent = 'Preparing viewer...';

    const markerAttr = this.getAttribute('show-markers');
    const showMarkers = markerAttr === null ? config.widget.showMarkers : markerAttr !== 'false';
    const locked = this.getAttribute('locked') === 'true' || config.widget.locked;
    const vrAttr = this.getAttribute('vr');
    const enableVr = vrAttr === null ? config.widget.enableVr : vrAttr === 'true';
    const requestedRenderer = (this.getAttribute('renderer') as RendererMode | null) || 'auto';
    this.currentQuality = (this.getAttribute('quality') as QualityPreset | null) || config.widget.quality || 'auto';
    this.currentCameraMode = locked ? 'locked' : 'orbit';
    this.buildControls();

    const viewerManifest = manifest as import('@gsplat/viewer-core').ViewerManifest;
    viewerManifest.viewer.enableVr = enableVr;

    this.viewer = new GsplatViewer({
      canvas: this.canvas,
      manifest: viewerManifest,
      markers,
      quality: this.currentQuality,
      cameraMode: this.currentCameraMode,
      rendererMode: requestedRenderer,
      locked,
      showMarkers,
      budgetOverride: this.getAttribute('budget') ? Number(this.getAttribute('budget')) : undefined,
      disablePostFx: this.getAttribute('nofx') === 'true',
      onProgress: (progress: ViewerRuntimeProgress) => {
        if (this.loadingEl && progress.phase !== 'complete') {
          const pct = progress.totalBytes && progress.loadedBytes !== undefined
            ? ` ${Math.round((progress.loadedBytes / progress.totalBytes) * 100)}%`
            : '';
          this.loadingEl.textContent = `${progress.message || progress.phase}${pct}`;
          this.loadingEl.style.display = 'flex';
        }
        this.dispatchEvent(new CustomEvent('viewer-progress', { detail: progress }));
      },
      onReady: () => {
        if (this.loadingEl) this.loadingEl.style.display = 'none';
        this.dispatchEvent(new CustomEvent('viewer-ready'));
      },
      onError: (error: Error) => {
        this.showError(error.message);
      },
      onStats: (stats: ViewerStats) => {
        // Can emit custom event
        this.dispatchEvent(new CustomEvent('viewer-stats', { detail: stats }));
      },
    });

    this.viewer.start().catch((err: Error) => {
      this.showError(err.message);
    });
  }

  private showMarkerInfo(marker: MarkerPoint): void {
    if (!this.infoPanel) return;
    this.infoPanel.className = 'info-panel open';
    this.infoPanel.replaceChildren();

    const closeBtnSafe = document.createElement('button');
    closeBtnSafe.className = 'close-btn';
    closeBtnSafe.textContent = 'x';
    closeBtnSafe.addEventListener('click', () => {
      if (this.infoPanel) this.infoPanel.className = 'info-panel';
      this.selectedMarker = null;
    });

    const title = document.createElement('h4');
    title.textContent = marker.title;
    this.infoPanel.append(closeBtnSafe, title);

    if (marker.body) {
      const body = document.createElement('p');
      body.textContent = marker.body;
      this.infoPanel.appendChild(body);
    }
  }

  private showError(msg: string): void {
    if (!this.container) return;
    const existing = this.container.querySelector('.error');
    if (existing) existing.remove();
    if (this.loadingEl) this.loadingEl.style.display = 'none';

    const errorEl = document.createElement('div');
    errorEl.className = 'error';
    errorEl.textContent = `Error: ${msg}`;
    this.container.appendChild(errorEl);
  }

  private destroy(): void {
    this.viewer?.destroy();
    if (this.shadow) {
      this.shadow.innerHTML = '';
    }
    this.viewer = null;
    this.canvas = null;
    this.container = null;
    this.selectedMarker = null;
    this.infoPanel = null;
    this.controlsBar = null;
    this.loadingEl = null;
  }
}

customElements.define('gs-viewer', GsViewerElement);
