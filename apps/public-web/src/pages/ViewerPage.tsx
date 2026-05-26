import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { GsplatViewer } from '@gsplat/viewer-core';
import type { ViewerManifest, MarkerPoint, ViewerStats, ViewerRuntimeProgress, ViewerLoadPhase } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const VIEWER_READY_KEY = 'gsplat_viewer_ready_v1';

interface DebugInfo {
  fps: number;
  splats: number;
  rendererMode: string;
  quality: string;
  frameTimeMs: number;
  gpuMemoryMB: number;
  drawCalls: number;
  activeSplats: number;
  budget: number;
  loadPhase: ViewerLoadPhase | string;
  assetFormat: string;
  lodActive: boolean;
}

function detectFeatures() {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const webxr = typeof navigator !== 'undefined' && 'xr' in navigator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vrSupported = webxr && typeof (navigator as any).xr?.isSessionSupported === 'function';
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return { webgpu, webxr, vrSupported, isMobile };
}

export default function ViewerPage() {
  const { slug } = useParams<{ slug: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<GsplatViewer | null>(null);
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [markers, setMarkers] = useState<MarkerPoint[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<MarkerPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerReady, setViewerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<string>(() => localStorage.getItem(VIEWER_READY_KEY + '_quality') || 'auto');
  const [cameraMode, setCameraMode] = useState<string>('orbit');
  const [showPoster, setShowPoster] = useState(true);
  const [loadProgress, setLoadProgress] = useState<ViewerRuntimeProgress | null>(null);
  const [features] = useState(detectFeatures());
  const [showDebug, setShowDebug] = useState(() => localStorage.getItem(VIEWER_READY_KEY + '_debug') === 'true');
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    fps: 0,
    splats: 0,
    rendererMode: '—',
    quality: '—',
    frameTimeMs: 0,
    gpuMemoryMB: 0,
    drawCalls: 0,
    activeSplats: 0,
    budget: 0,
    loadPhase: '—',
    assetFormat: '—',
    lodActive: false,
  });

  // Fetch manifest and markers
  useEffect(() => {
    if (!slug) return;

    setLoading(true);
    setError(null);
    setShowPoster(true);

    Promise.all([
      fetch(`${API_BASE}/splats/${slug}/manifest`).then((res) => {
        if (!res.ok) throw new Error(`Failed to load manifest (${res.status})`);
        return res.json();
      }),
      fetch(`${API_BASE}/splats/${slug}/markers`).then((res) => {
        if (!res.ok) throw new Error(`Failed to load markers (${res.status})`);
        return res.json();
      }),
    ])
      .then(([manifestData, markersData]) => {
        if (!manifestData) throw new Error('Invalid manifest data');
        setManifest(manifestData);
        setMarkers(markersData.items || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
        setShowPoster(false);
      });
  }, [slug]);

  // Initialize viewer when manifest loads and canvas mounts
  useEffect(() => {
    if (!manifest || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const viewer = new GsplatViewer({
      canvas,
      manifest,
      markers,
      cameraMode: 'orbit',
      quality: quality as 'auto' | 'low' | 'medium' | 'high' | 'ultra',
      rendererMode: manifest.viewer?.enableWebGpu ? 'auto' : 'webgl2',
      showMarkers: true,
      onProgress: (progress: ViewerRuntimeProgress) => {
        setLoadProgress(progress);
      },
      onReady: () => {
        setViewerReady(true);
        setTimeout(() => setShowPoster(false), 300);
      },
      onError: (err: Error) => {
        console.error('Viewer error:', err);
        setShowPoster(false);
      },
      onStats: (stats: ViewerStats) => {
        setDebugInfo({
          fps: stats.fps,
          splats: stats.approximateLoadedSplats ?? 0,
          rendererMode: stats.rendererMode,
          quality: stats.quality,
          frameTimeMs: stats.fps > 0 ? Math.round(1000 / stats.fps) : 0,
          gpuMemoryMB: (performance as any).memory?.usedJSHeapSize
            ? Math.round((performance as any).memory.usedJSHeapSize / 1048576)
            : 0,
          drawCalls: 0,
          activeSplats: stats.activeSplats || stats.approximateLoadedSplats || 0,
          budget: stats.splatBudget,
          loadPhase: stats.loadPhase || '—',
          assetFormat: stats.assetFormat || manifest.assets.format || '—',
          lodActive: Boolean(stats.lodActive),
        });
      },
    });

    viewer.start().catch((err: Error) => {
      console.error('Viewer start failed:', err);
      setShowPoster(false);
      setError(err.message);
    });
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      setViewerReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, markers]);

  // Sync markers to existing viewer
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setMarkers(markers);
    }
  }, [markers]);

  // Sync quality changes
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setQuality(quality as 'auto' | 'low' | 'medium' | 'high' | 'ultra');
    }
    localStorage.setItem(VIEWER_READY_KEY + '_quality', quality);
  }, [quality]);

  // Sync camera mode changes
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setCameraMode(cameraMode as 'orbit' | 'fly' | 'locked');
    }
  }, [cameraMode]);

  // Toggle debug overlay with ` key
  const toggleDebug = useCallback(() => {
    setShowDebug((prev) => {
      const next = !prev;
      localStorage.setItem(VIEWER_READY_KEY + '_debug', String(next));
      return next;
    });
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '`') toggleDebug();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleDebug]);

  // Loading state
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading scene...</p>
      </div>
    );
  }

  // Error state
  if (error || !manifest) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>Failed to load scene: {error || 'Not found'}</p>
        <Link to="/splats" style={styles.backLink}>
          ← Back to scenes
        </Link>
      </div>
    );
  }

  const posterUrl = manifest.assets?.posterUrl;
  const showPosterOverlay = showPoster && posterUrl;
  return (
    <div style={styles.viewerContainer}>
      {/* Poster overlay with fade */}
      {showPosterOverlay && (
        <div
          style={{
            ...styles.posterOverlay,
            opacity: viewerReady ? 0 : 1,
          }}
        >
          <img
            src={posterUrl}
            alt={manifest.title}
            style={styles.posterImage}
            onError={() => setShowPoster(false)}
          />
          {!viewerReady && (
            <div style={styles.spinnerOverlay}>
              <div style={styles.spinner} />
              {loadProgress && (
                <div style={styles.progressText}>
                  {loadProgress.message || loadProgress.phase}
                  {loadProgress.totalBytes && loadProgress.loadedBytes !== undefined
                    ? ` · ${Math.round((loadProgress.loadedBytes / loadProgress.totalBytes) * 100)}%`
                    : ''}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <Link to="/splats" style={styles.backButton} tabIndex={0}>
            ← Scenes
          </Link>
          <span style={styles.sceneTitle}>{manifest.title}</span>
          {!features.webgpu && (
            <span style={styles.featureBadgeOff} title="WebGPU not available in this browser">
              WebGL2
            </span>
          )}
          {features.webgpu && (
            <span style={styles.featureBadgeOn} title="WebGPU available">
              WebGPU
            </span>
          )}
        </div>

        <div style={styles.controlsGroup}>
          <select
            value={cameraMode}
            onChange={(e) => setCameraMode(e.target.value)}
            style={styles.selectInput}
            aria-label="Camera mode"
          >
            <option value="orbit">Orbit</option>
            <option value="fly">Fly</option>
            <option value="walk">Walk</option>
            {manifest.viewer?.lockScene && <option value="locked">Locked</option>}
          </select>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            style={styles.selectInput}
            aria-label="Quality preset"
          >
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select>
          {manifest.viewer?.enableVr && features.vrSupported && (
            <button
              onClick={() => viewerRef.current?.enterVr()}
              style={styles.vrButton}
              title="Enter VR mode"
              aria-label="Enter VR"
            >
              VR
            </button>
          )}
          {manifest.viewer?.enableVr && !features.vrSupported && (
            <span style={styles.vrUnavailable} title="WebXR VR not available in this browser">
              VR ✕
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={styles.mainContent}>
        {/* 3D Viewer Canvas */}
        <div style={styles.canvasWrapper}>
          <canvas ref={canvasRef} style={styles.canvas} />
        </div>

        {/* Annotation side panel (desktop) — hidden on mobile */}
        {false && selectedMarker && (
          <div style={styles.annotationPanel} role="complementary" aria-label="Marker information">
            <div style={styles.annotationPanelHeader}>
              <h3 style={styles.annotationTitle}>{selectedMarker!.title}</h3>
              <button
                onClick={() => setSelectedMarker(null)}
                style={styles.closeButton}
                aria-label="Close panel"
                tabIndex={0}
              >
                ×
              </button>
            </div>
            {selectedMarker!.body && (
              <p style={styles.annotationBody}>{selectedMarker!.body}</p>
            )}
            <div style={styles.annotationMeta}>
              <span style={styles.annotationKind}>
                {selectedMarker!.kind || 'info'}
              </span>
              <span style={styles.annotationCoords}>
                [{selectedMarker!.position.map((v) => v.toFixed(1)).join(', ')}]
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Annotation list at bottom (quick reference) */}
      {false && markers.length > 0 && !selectedMarker && (
        <div style={styles.annotationList} role="list" aria-label="Scene markers">
          {markers.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedMarker(a)}
              style={styles.annotationChip}
              tabIndex={0}
              role="listitem"
            >
              {a.title}
            </button>
          ))}
        </div>
      )}

      {/* Mobile bottom sheet for selected marker */}
      {false && selectedMarker && (
        <>
          <div style={styles.bottomSheetOverlay} onClick={() => setSelectedMarker(null)} />
          <div style={styles.bottomSheet} role="dialog" aria-label="Marker details">
            <div style={styles.bottomSheetHandle} />
            <div style={styles.annotationPanelHeader}>
              <h3 style={styles.annotationTitle}>{selectedMarker!.title}</h3>
              <button
                onClick={() => setSelectedMarker(null)}
                style={styles.closeButton}
                aria-label="Close"
                tabIndex={0}
              >
                ×
              </button>
            </div>
            {selectedMarker!.body && (
              <p style={styles.annotationBody}>{selectedMarker!.body}</p>
            )}
            <div style={styles.annotationMeta}>
              <span style={styles.annotationKind}>
                {selectedMarker!.kind || 'info'}
              </span>
              <span style={styles.annotationCoords}>
                [{selectedMarker!.position.map((v) => v.toFixed(1)).join(', ')}]
              </span>
            </div>
          </div>
        </>
      )}
      {/* Debug overlay — toggle with ` key */}
      {showDebug && (
        <div style={styles.debugOverlay} aria-label="Debug info" role="region">
          <div style={styles.debugHeader}>
            <span style={styles.debugTitle}>🔍 Debug</span>
            <span style={styles.debugHint}>Press ` to hide</span>
          </div>
          <div style={styles.debugGrid}>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>FPS</span>
              <span style={{ ...styles.debugValue, color: debugInfo.fps < 30 ? '#ef4444' : '#22c55e' }}>{debugInfo.fps}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Frame</span>
              <span style={styles.debugValue}>{debugInfo.frameTimeMs}ms</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Splats</span>
              <span style={styles.debugValue}>{debugInfo.splats.toLocaleString()}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Active</span>
              <span style={styles.debugValue}>{debugInfo.activeSplats.toLocaleString()}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Budget</span>
              <span style={styles.debugValue}>{debugInfo.budget.toLocaleString()}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Renderer</span>
              <span style={styles.debugValue}>{debugInfo.rendererMode}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Asset</span>
              <span style={styles.debugValue}>{debugInfo.assetFormat}{debugInfo.lodActive ? ' LOD' : ''}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Phase</span>
              <span style={styles.debugValue}>{debugInfo.loadPhase}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Quality</span>
              <span style={styles.debugValue}>{debugInfo.quality}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>JS Heap</span>
              <span style={styles.debugValue}>{debugInfo.gpuMemoryMB}MB</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Styles ──────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    background: '#050505',
  },
  loadingText: {
    color: '#a3a3a3',
    fontSize: '0.875rem',
  },
  errorContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    background: '#050505',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '0.875rem',
  },
  backLink: {
    color: '#a3a3a3',
    textDecoration: 'underline',
    fontSize: '0.8125rem',
  },
  viewerContainer: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#050505',
    position: 'relative',
  },
  posterOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    background: '#050505',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 400ms ease',
    pointerEvents: 'none',
  },
  posterImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  spinnerOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    background: 'rgba(5, 5, 5, 0.5)',
  },
  progressText: {
    color: '#f5f5f5',
    fontSize: '0.75rem',
    background: 'rgba(13,13,13,0.72)',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '0.375rem 0.625rem',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #2a2a2a',
    borderTopColor: '#f5f5f5',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    background: '#0d0d0d',
    borderBottom: '1px solid #2a2a2a',
    zIndex: 10,
    flexShrink: 0,
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  backButton: {
    color: '#a3a3a3',
    textDecoration: 'none',
    fontSize: '0.875rem',
  },
  sceneTitle: {
    color: '#f5f5f5',
    fontWeight: 600,
    fontSize: '0.9375rem',
  },
  controlsGroup: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  selectInput: {
    padding: '0.375rem 0.75rem',
    background: '#171717',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#a3a3a3',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  vrButton: {
    padding: '0.375rem 0.75rem',
    background: '#171717',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#a3a3a3',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    position: 'relative',
    minHeight: 0,
    animation: 'fadeIn 300ms ease',
  },
  canvasWrapper: {
    flex: 1,
    position: 'relative',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
  },
  annotationPanel: {
    width: 340,
    background: '#0d0d0d',
    borderLeft: '1px solid #2a2a2a',
    padding: '1.25rem',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    flexShrink: 0,
    animation: 'slideInRight 200ms ease',
  },
  annotationPanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  annotationTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#f5f5f5',
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#737373',
    cursor: 'pointer',
    fontSize: '1.25rem',
    padding: 0,
    lineHeight: 1,
  },
  annotationBody: {
    fontSize: '0.875rem',
    color: '#a3a3a3',
    lineHeight: 1.5,
    margin: 0,
  },
  annotationMeta: {
    fontSize: '0.75rem',
    color: '#737373',
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  annotationKind: {
    padding: '0.125rem 0.5rem',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
  },
  annotationCoords: {
    fontFamily: 'monospace',
  },
  annotationList: {
    padding: '0.5rem 1rem',
    background: '#0d0d0d',
    borderTop: '1px solid #2a2a2a',
    display: 'flex',
    gap: '0.5rem',
    overflowX: 'auto',
    zIndex: 5,
    flexShrink: 0,
  },
  annotationChip: {
    padding: '0.375rem 0.75rem',
    background: '#171717',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#a3a3a3',
    cursor: 'pointer',
    fontSize: '0.75rem',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  // Feature badges
  featureBadgeOn: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: '#0a2a0a',
    border: '1px solid #22c55e',
    borderRadius: 4,
    color: '#22c55e',
    fontWeight: 600,
  },
  featureBadgeOff: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    color: '#737373',
  },
  vrUnavailable: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    color: '#737373',
    cursor: 'not-allowed',
  },
  // Mobile bottom sheet
  bottomSheetOverlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 30,
    animation: 'fadeIn 150ms ease',
  },
  bottomSheet: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: '#0d0d0d',
    borderTop: '1px solid #2a2a2a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: '1rem 1.25rem 1.5rem',
    zIndex: 31,
    animation: 'slideUp 250ms ease',
    maxHeight: '60vh',
    overflowY: 'auto' as const,
  },
  bottomSheetHandle: {
    width: 36,
    height: 4,
    background: '#2a2a2a',
    borderRadius: 2,
    margin: '0 auto 0.75rem',
  },
  // Debug overlay
  debugOverlay: {
    position: 'fixed' as const,
    top: 60,
    right: 12,
    width: 220,
    background: 'rgba(13,13,13,0.92)',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: '0.75rem',
    zIndex: 50,
    fontFamily: 'monospace',
    fontSize: '0.6875rem',
    backdropFilter: 'blur(8px)',
    animation: 'fadeIn 150ms ease',
  },
  debugHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: '0.5rem',
    paddingBottom: '0.375rem',
    borderBottom: '1px solid #2a2a2a',
  },
  debugTitle: {
    color: '#f5f5f5',
    fontWeight: 600,
  },
  debugHint: {
    color: '#737373',
    fontSize: '0.5625rem',
  },
  debugGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
  },
  debugRow: {
    display: 'flex',
    justifyContent: 'space-between' as const,
  },
  debugLabel: {
    color: '#737373',
  },
  debugValue: {
    color: '#a3a3a3',
    fontWeight: 600,
  },
};

// Inject CSS keyframes
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideInRight {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
`;
document.head.appendChild(styleSheet);
