import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  GsplatViewer,
  analyzeQuestPerfTrace,
  appendQuestPerfSample,
  createDefaultQuestPerfExperiments,
  createQuestPerfSample,
  createQuestPerfTrace,
  exportQuestPerfCsv,
  exportQuestPerfJson,
  summarizeQuestPerfTrace,
} from '@gsplat/viewer-core';
import type {
  QuestPerfExperiment,
  QuestPerfExperimentPhase,
  QuestPerfTrace,
  QuestPerfVerdict,
} from '@gsplat/viewer-core';
import type { AssetVariantSelection, AuthUser, ViewerManifest, MarkerPoint, ViewerStats, ViewerRuntimeProgress, ViewerLoadPhase } from '@gsplat/shared';
import { LanguageSwitch, useI18n } from '../i18n';
import { ThemeIcon, useTheme, type AppTheme } from '../theme';
import { canUseQuestPerformance } from '../viewerPermissions';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const VIEWER_READY_KEY = 'gsplat_viewer_ready_v1';

type RendererPref = 'webgl2' | 'webgpu';
const VIEWER_BACKGROUND_COLORS: Record<AppTheme, [number, number, number]> = {
  dark: [0.02, 0.02, 0.02],
  light: [0.88, 0.86, 0.8],
};

interface DebugInfo {
  fps: number;
  splats: number;
  rendererMode: string;
  rendererPipeline: string;
  quality: string;
  frameTimeMs: number;
  frameP95Ms: number;
  sortTimeMs: number;
  gpuTimeMs: number;
  gpuTimerStatus: string;
  cpuUpdateMs: number;
  gpuMemoryMB: number;
  drawCalls: number;
  activeSplats: number;
  budget: number;
  minPixelSize: number;
  minContribution: number;
  alphaClip: number;
  lodRange: string;
  adaptiveQualityScale: number;
  devicePixelRatio: number;
  loadPhase: ViewerLoadPhase | string;
  assetFormat: string;
  assetVariant: string;
  lodActive: boolean;
  renderOnDemand: boolean;
  xrActive: boolean;
  xrFrameRate: number;
  xrFramebufferScale: number;
  fixedFoveation: number | null;
  lodLoadingCount: number;
}

function detectFeaturesSync() {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const webxr = typeof navigator !== 'undefined' && 'xr' in navigator;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return { webgpu, webxr, isMobile };
}

/**
 * Probes real VR support by calling `navigator.xr.isSessionSupported('immersive-vr')`.
 * Returns `null` while the async check is running, `true` when VR is available,
 * or `false` when it is not.
 */
async function probeVrSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xr = (navigator as any).xr;
  if (!xr || typeof xr.isSessionSupported !== 'function') return false;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas capture failed'));
    }, type, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Canvas capture could not be encoded'));
    reader.readAsDataURL(blob);
  });
}

export default function ViewerPage() {
  const { t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const { theme, toggleTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<GsplatViewer | null>(null);
  const pendingVrStartRef = useRef(false);
  const benchmarkSamplesRef = useRef<Record<string, Array<{ fps: number; frameTimeMs: number; activeSplats: number; budget: number }>>>({});
  const questTraceRef = useRef<QuestPerfTrace | null>(null);
  const questPerfCapturingRef = useRef(false);
  const activeExperimentRef = useRef<{ experiment: QuestPerfExperiment; phase: QuestPerfExperimentPhase } | null>(null);
  const experimentRunnerRef = useRef<{
    running: boolean;
    experiments: QuestPerfExperiment[];
    index: number;
    phase: QuestPerfExperimentPhase;
    phaseStartedAt: number;
  } | null>(null);
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [markers, setMarkers] = useState<MarkerPoint[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<MarkerPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerReady, setViewerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vrError, setVrError] = useState<string | null>(null);
  const [vrActive, setVrActive] = useState(false);
  const [vrLaunchPending, setVrLaunchPending] = useState(false);
  const [assetVariant, setAssetVariant] = useState<AssetVariantSelection>('auto');
  const [rendererPref, setRendererPref] = useState<RendererPref>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEWER_READY_KEY + '_renderer') : null;
    if (saved === 'webgpu') return 'webgpu';
    if (saved === 'webgl2') return 'webgl2';
    // Default to WebGL2 for visual stability. WebGPU is opt-in via the toggle button.
    return 'webgl2';
  });
  const [quality, setQuality] = useState<string>(() => localStorage.getItem(VIEWER_READY_KEY + '_quality') || 'auto');
  const [cameraMode, setCameraMode] = useState<string>('orbit');
  const [showPoster, setShowPoster] = useState(true);
  const [loadProgress, setLoadProgress] = useState<ViewerRuntimeProgress | null>(null);
  const [features] = useState(detectFeaturesSync);
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);
  const [vrChecked, setVrChecked] = useState(false);
  const [showDebug, setShowDebug] = useState(() => localStorage.getItem(VIEWER_READY_KEY + '_debug') === 'true');
  const [adminCanCapturePreview, setAdminCanCapturePreview] = useState(false);
  const [questPerfAllowed, setQuestPerfAllowed] = useState(false);
  const [capturePreviewBusy, setCapturePreviewBusy] = useState(false);
  const [showQuestPerf, setShowQuestPerf] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('questPerf') === '1' || localStorage.getItem(VIEWER_READY_KEY + '_quest_perf') === 'true';
  });
  const [questPerfCapturing, setQuestPerfCapturing] = useState(false);
  const [questPerfTrace, setQuestPerfTrace] = useState<QuestPerfTrace | null>(null);
  const [questPerfVerdict, setQuestPerfVerdict] = useState<QuestPerfVerdict | null>(null);
  const [questPerfExperiment, setQuestPerfExperiment] = useState<string>('Idle');
  const [questPerfSampleCount, setQuestPerfSampleCount] = useState(0);
  const [questPerfCopied, setQuestPerfCopied] = useState(false);
  const questPerfExperiments = useRef(createDefaultQuestPerfExperiments({ includeRestartRequired: false }));
  const benchmarkEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('benchmark') === '1';
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    fps: 0,
    splats: 0,
    rendererMode: '-',
    rendererPipeline: '-',
    quality: '-',
    frameTimeMs: 0,
    frameP95Ms: 0,
    sortTimeMs: 0,
    gpuTimeMs: 0,
    gpuTimerStatus: 'disabled',
    cpuUpdateMs: 0,
    gpuMemoryMB: 0,
    drawCalls: 0,
    activeSplats: 0,
    budget: 0,
    minPixelSize: 0,
    minContribution: 0,
    alphaClip: 0,
    lodRange: '-',
    adaptiveQualityScale: 1,
    devicePixelRatio: 1,
    loadPhase: '-',
    assetFormat: '-',
    assetVariant: '-',
    lodActive: false,
    renderOnDemand: false,
    xrActive: false,
    xrFrameRate: 0,
    xrFramebufferScale: 0,
    fixedFoveation: null,
    lodLoadingCount: 0,
  });

  // Probe real VR support asynchronously (required for secure-context check
  // on mobile XR browsers like Quest Browser).
  useEffect(() => {
    let cancelled = false;
    probeVrSupport().then((ok) => {
      if (!cancelled) {
        setVrSupported(ok);
        setVrChecked(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const user = data?.user as AuthUser | null | undefined;
        const allowed = canUseQuestPerformance(user);
        setAdminCanCapturePreview(Boolean(user?.capabilities?.canAccessAdmin));
        setQuestPerfAllowed(allowed);
        if (!allowed) setShowQuestPerf(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAdminCanCapturePreview(false);
        setQuestPerfAllowed(false);
        setShowQuestPerf(false);
      });
    return () => { cancelled = true; };
  }, []);

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

  // Toggle renderer, then recreate the viewer with the new preference.
  const toggleRenderer = useCallback(() => {
    if (vrActive || vrLaunchPending) return;
    setRendererPref((prev) => {
      const next: RendererPref = prev === 'webgpu' ? 'webgl2' : 'webgpu';
      localStorage.setItem(VIEWER_READY_KEY + '_renderer', next);
      return next;
    });
    // Force viewer recreation by resetting ready flag
    setViewerReady(false);
    setShowPoster(true);
    setVrError(null);
  }, [vrActive, vrLaunchPending]);

  const setQuestPerfPanelVisible = useCallback((visible: boolean) => {
    if (visible && !questPerfAllowed) return;
    setShowQuestPerf(visible);
    localStorage.setItem(VIEWER_READY_KEY + '_quest_perf', String(visible));
  }, [questPerfAllowed]);

  const handleTakePreview = useCallback(async () => {
    if (!manifest || !canvasRef.current || !viewerReady || capturePreviewBusy) return;

    setCapturePreviewBusy(true);
    setVrError(null);
    try {
      const canvas = canvasRef.current;
      const blob = await canvasToBlob(canvas);
      const dataUrl = await blobToDataUrl(blob);
      const createdAt = new Date().toISOString();
      sessionStorage.setItem(`gsplat_taken_preview_${manifest.id}`, JSON.stringify({
        dataUrl,
        name: `${manifest.slug}-viewer-${Date.now()}.jpg`,
        width: canvas.width,
        height: canvas.height,
        createdAt,
      }));
      window.location.assign(`/admin/splats/${manifest.id}?tab=preview`);
    } catch (err) {
      setVrError(err instanceof Error ? err.message : 'Preview capture failed');
      setCapturePreviewBusy(false);
    }
  }, [capturePreviewBusy, manifest, viewerReady]);

  const startQuestPerfCapture = useCallback((experiments?: QuestPerfExperiment[]) => {
    if (!manifest || !questPerfAllowed) return;
    const trace = createQuestPerfTrace({
      sceneId: manifest.id,
      sceneSlug: manifest.slug,
      targetFps: 72,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
    questTraceRef.current = trace;
    questPerfCapturingRef.current = true;
    setQuestPerfTrace(trace);
    setQuestPerfVerdict(null);
    setQuestPerfSampleCount(0);
    setQuestPerfCapturing(true);
    setQuestPerfPanelVisible(true);
    viewerRef.current?.setQuestPerfEnabled(true);

    if (experiments?.length) {
      experimentRunnerRef.current = {
        running: true,
        experiments,
        index: 0,
        phase: 'warmup',
        phaseStartedAt: performance.now(),
      };
      activeExperimentRef.current = { experiment: experiments[0]!, phase: 'warmup' };
      setQuestPerfExperiment(`${experiments[0]!.label} warmup`);
      viewerRef.current?.setQuestPerfOverrides(experiments[0]!.overrides);
    } else {
      experimentRunnerRef.current = null;
      activeExperimentRef.current = null;
      setQuestPerfExperiment('Manual capture');
    }
  }, [manifest, questPerfAllowed, setQuestPerfPanelVisible]);

  const stopQuestPerfCapture = useCallback(() => {
    const trace = questTraceRef.current;
    questPerfCapturingRef.current = false;
    experimentRunnerRef.current = null;
    activeExperimentRef.current = null;
    setQuestPerfCapturing(false);
    setQuestPerfExperiment('Idle');
    viewerRef.current?.setQuestPerfOverrides({});
    viewerRef.current?.setQuestPerfEnabled(questPerfAllowed && showQuestPerf);
    if (!trace) return;
    trace.endedAt = new Date().toISOString();
    const verdict = analyzeQuestPerfTrace(trace);
    setQuestPerfVerdict(verdict);
    setQuestPerfTrace({ ...trace, samples: trace.samples });
    setQuestPerfSampleCount(trace.samples.length);
  }, [questPerfAllowed, showDebug, showQuestPerf]);

  const downloadQuestPerfTrace = useCallback((format: 'csv' | 'json') => {
    const trace = questTraceRef.current || questPerfTrace;
    if (!trace) return;
    const text = format === 'csv' ? exportQuestPerfCsv(trace) : exportQuestPerfJson(trace);
    const blob = new Blob([text], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${trace.id}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [questPerfTrace]);

  const copyQuestPerfSummary = useCallback(async () => {
    const trace = questTraceRef.current || questPerfTrace;
    if (!trace) return;
    const summary = summarizeQuestPerfTrace(trace);
    try {
      await navigator.clipboard?.writeText(summary);
      setQuestPerfCopied(true);
      window.setTimeout(() => setQuestPerfCopied(false), 1200);
    } catch {
      setQuestPerfCopied(false);
    }
  }, [questPerfTrace]);

  const runQuestPerfMatrix = useCallback(() => {
    startQuestPerfCapture(questPerfExperiments.current);
  }, [startQuestPerfCapture]);

  // Initialize viewer when manifest loads and canvas mounts, or when rendererPref changes
  useEffect(() => {
    if (!manifest || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let activeViewer: GsplatViewer | null = null;
    const viewer = new GsplatViewer({
      canvas,
      manifest,
      markers,
      cameraMode: 'orbit',
      quality: quality as 'auto' | 'low' | 'medium' | 'high',
      rendererMode: rendererPref,
      assetVariant,
      xrQuality: 'balanced',
      xrFramebufferScale: 0.6,
      xrFixedFoveation: 1,
      webgpuPipeline: 'off',
      showMarkers: true,
      questPerfEnabled: questPerfAllowed && (showQuestPerf || questPerfCapturing),
      backgroundColor: VIEWER_BACKGROUND_COLORS[theme],
      onProgress: (progress: ViewerRuntimeProgress) => {
        setLoadProgress(progress);
      },
      onReady: () => {
        setViewerReady(true);
        setTimeout(() => setShowPoster(false), 300);
        if (pendingVrStartRef.current) {
          pendingVrStartRef.current = false;
          void activeViewer?.enterVr()
            .then(() => {
              setVrActive(true);
              setVrLaunchPending(false);
            })
            .catch((err: Error) => {
              setVrLaunchPending(false);
              setAssetVariant('auto');
              setVrError(err.message);
            });
        }
      },
      onVrSessionChange: (active: boolean) => {
        setVrActive(active);
        if (!active && !pendingVrStartRef.current) {
          setAssetVariant('auto');
          setVrLaunchPending(false);
        }
      },
      onCameraModeChange: (mode) => {
        setCameraMode(mode);
      },
      onError: (err: Error) => {
        console.error('Viewer error:', err);
        setVrError(err.message);
        setShowPoster(false);
      },
      onQuestPerfSample: (stats: ViewerStats) => {
        if (!questPerfCapturingRef.current || !questTraceRef.current) return;
        const activeExperiment = activeExperimentRef.current;
        if (activeExperiment && activeExperiment.phase !== 'capture') return;
        const sample = createQuestPerfSample(stats, {
          traceId: questTraceRef.current.id,
          sceneId: manifest.id,
          sceneSlug: manifest.slug,
          experimentId: activeExperiment?.experiment.id,
          experimentLabel: activeExperiment?.experiment.label,
          experimentPhase: activeExperiment?.phase,
        });
        appendQuestPerfSample(questTraceRef.current, sample);
      },
      onStats: (stats: ViewerStats) => {
        if (benchmarkEnabled && stats.loadPhase !== 'loading-asset' && stats.loadPhase !== 'loading-metadata') {
          const key = stats.quality;
          const samples = benchmarkSamplesRef.current[key] ?? [];
          samples.push({
            fps: stats.fps,
            frameTimeMs: stats.frameTimeMs ?? (stats.fps > 0 ? 1000 / stats.fps : 0),
            activeSplats: stats.actualRenderedSplats ?? stats.activeSplats ?? 0,
            budget: stats.splatBudget,
          });
          benchmarkSamplesRef.current[key] = samples.slice(-12);
        }

        setDebugInfo({
          fps: stats.fps,
          splats: stats.approximateLoadedSplats ?? 0,
          rendererMode: stats.gsplatRenderer ? `${stats.rendererMode}/${stats.gsplatRenderer}` : stats.rendererMode,
          rendererPipeline: stats.rendererPipeline || '-',
          quality: stats.quality,
          frameTimeMs: stats.frameTimeMs ? Math.round(stats.frameTimeMs) : stats.fps > 0 ? Math.round(1000 / stats.fps) : 0,
          frameP95Ms: stats.frameP95Ms ? Math.round(stats.frameP95Ms) : 0,
          sortTimeMs: stats.sortTimeMs ?? 0,
          gpuTimeMs: stats.gpuTimeMs ?? 0,
          gpuTimerStatus: stats.gpuTimerStatus || 'disabled',
          cpuUpdateMs: stats.cpu?.totalUpdateMs ?? 0,
          gpuMemoryMB: stats.jsHeapUsedMB ? Math.round(stats.jsHeapUsedMB) : 0,
          drawCalls: 0,
          activeSplats: stats.actualRenderedSplats ?? stats.activeSplats ?? stats.approximateLoadedSplats ?? 0,
          budget: stats.splatBudget,
          minPixelSize: stats.minPixelSize ?? 0,
          minContribution: stats.minContribution ?? 0,
          alphaClip: stats.alphaClip ?? 0,
          lodRange: stats.lodRange ? `${stats.lodRange[0]}-${stats.lodRange[1]}` : '-',
          adaptiveQualityScale: stats.adaptiveQualityScale ?? 1,
          devicePixelRatio: stats.devicePixelRatio ?? 1,
          loadPhase: stats.loadPhase || '-',
          assetFormat: stats.assetFormat || manifest.assets.format || '-',
          assetVariant: stats.activeAssetVariant || 'base',
          lodActive: Boolean(stats.lodActive),
          renderOnDemand: Boolean(stats.renderOnDemand),
          xrActive: Boolean(stats.xrActive),
          xrFrameRate: stats.xrFrameRate ?? 0,
          xrFramebufferScale: stats.xrFramebufferScale ?? 0,
          fixedFoveation: stats.fixedFoveation ?? null,
          lodLoadingCount: stats.lodLoadingCount ?? 0,
        });

        if (questTraceRef.current) {
          setQuestPerfSampleCount(questTraceRef.current.samples.length);
          setQuestPerfVerdict(analyzeQuestPerfTrace(questTraceRef.current));
          setQuestPerfTrace({ ...questTraceRef.current, samples: questTraceRef.current.samples });
        }
      },
    });

    viewer.start().catch((err: Error) => {
      console.error('Viewer start failed:', err);
      pendingVrStartRef.current = false;
      setVrLaunchPending(false);
      setShowPoster(false);
      setError(err.message);
    });
    activeViewer = viewer;
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      setViewerReady(false);
      setVrActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, markers, rendererPref, assetVariant]);

  // Update background color on theme change without destroying/recreating the viewer
  useEffect(() => {
    viewerRef.current?.setBackgroundColor(VIEWER_BACKGROUND_COLORS[theme]);
  }, [theme]);

  useEffect(() => {
    viewerRef.current?.setQuestPerfEnabled(questPerfAllowed && (showQuestPerf || questPerfCapturing));
  }, [questPerfAllowed, showDebug, showQuestPerf, questPerfCapturing]);

  useEffect(() => {
    if (!questPerfCapturing || !experimentRunnerRef.current) return;

    const intervalId = window.setInterval(() => {
      const runner = experimentRunnerRef.current;
      if (!runner?.running) return;
      const experiment = runner.experiments[runner.index];
      if (!experiment) {
        stopQuestPerfCapture();
        return;
      }

      const elapsed = performance.now() - runner.phaseStartedAt;
      if (runner.phase === 'warmup' && elapsed >= experiment.warmupMs) {
        runner.phase = 'capture';
        runner.phaseStartedAt = performance.now();
        activeExperimentRef.current = { experiment, phase: 'capture' };
        setQuestPerfExperiment(`${experiment.label} capture`);
        return;
      }

      if (runner.phase === 'capture' && elapsed >= experiment.captureMs) {
        runner.index += 1;
        const next = runner.experiments[runner.index];
        if (!next) {
          stopQuestPerfCapture();
          return;
        }
        runner.phase = 'warmup';
        runner.phaseStartedAt = performance.now();
        activeExperimentRef.current = { experiment: next, phase: 'warmup' };
        setQuestPerfExperiment(`${next.label} warmup`);
        viewerRef.current?.setQuestPerfOverrides(next.overrides);
      }
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [questPerfCapturing, stopQuestPerfCapture]);

  // Sync markers to existing viewer
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setMarkers(markers);
    }
  }, [markers]);

  // Sync quality changes
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setQuality(quality as 'auto' | 'low' | 'medium' | 'high');
    }
    localStorage.setItem(VIEWER_READY_KEY + '_quality', quality);
  }, [quality]);

  useEffect(() => {
    if (!benchmarkEnabled || !viewerReady || !viewerRef.current) return;

    const qualities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
    let index = 0;
    benchmarkSamplesRef.current = {};
    setQuality(qualities[index]!);

    const intervalId = window.setInterval(() => {
      index += 1;
      if (index < qualities.length) {
        setQuality(qualities[index]!);
        return;
      }

      window.clearInterval(intervalId);
      const summary = Object.fromEntries(
        Object.entries(benchmarkSamplesRef.current).map(([name, samples]) => {
          const count = Math.max(1, samples.length);
          return [name, {
            avgFps: Math.round(samples.reduce((sum, sample) => sum + sample.fps, 0) / count),
            avgFrameMs: Math.round(samples.reduce((sum, sample) => sum + sample.frameTimeMs, 0) / count),
            avgActiveSplats: Math.round(samples.reduce((sum, sample) => sum + sample.activeSplats, 0) / count),
            budget: samples[samples.length - 1]?.budget ?? 0,
          }];
        }),
      );
      console.table(summary);
      window.dispatchEvent(new CustomEvent('gsplat-benchmark-complete', { detail: summary }));
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [benchmarkEnabled, viewerReady]);

  // Sync camera mode changes
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.setCameraMode(cameraMode as 'orbit' | 'fly' | 'locked');
    }
  }, [cameraMode]);

  // VR entry handler surfaces errors to the user instead of swallowing them.
  const handleEnterVr = useCallback(async () => {
    setVrError(null);
    if (rendererPref !== 'webgl2' || assetVariant !== 'vr') {
      pendingVrStartRef.current = true;
      setVrLaunchPending(true);
      setViewerReady(false);
      setShowPoster(true);
      setAssetVariant('vr');
      if (rendererPref !== 'webgl2') {
        localStorage.setItem(VIEWER_READY_KEY + '_renderer', 'webgl2');
        setRendererPref('webgl2');
      }
      return;
    }
    try {
      await viewerRef.current?.enterVr();
      setVrActive(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'VR failed';
      setVrError(message);
      setVrLaunchPending(false);
    }
  }, [assetVariant, rendererPref]);

  const handleExitVr = useCallback(async () => {
    setVrError(null);
    try {
      await viewerRef.current?.exitVr();
      setVrActive(false);
      setAssetVariant('auto');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'VR exit failed';
      setVrError(message);
    }
  }, []);

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
        <p style={styles.loadingText}>{t('viewer.loading')}</p>
      </div>
    );
  }

  // Error state
  if (error || !manifest) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>{error || t('viewer.loading')}</p>
        <Link to="/splats" style={styles.backLink}>
          {t('viewer.back')}
        </Link>
      </div>
    );
  }

  const posterUrl = manifest.assets?.posterUrl;
  const showPosterOverlay = showPoster && posterUrl;
  const rendererToggleLocked = vrActive || vrLaunchPending;
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

      {/* VR error toast */}
      {vrError && (
        <div style={styles.vrErrorToast} role="alert">
          <span>{vrError}</span>
          <button
            onClick={() => setVrError(null)}
            style={styles.vrErrorClose}
            aria-label={t('viewer.close')}
          >
            ×
          </button>
        </div>
      )}

      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <Link to="/splats" style={styles.backButton} tabIndex={0}>
            {t('viewer.back')}
          </Link>
          <span style={styles.sceneTitle}>{manifest.title}</span>
          {/* Clickable renderer toggle replaces static badges. */}
          {features.webgpu ? (
            <button
              onClick={toggleRenderer}
              disabled={rendererToggleLocked}
              style={{
                ...(rendererPref === 'webgpu' ? styles.rendererBadgeActive : styles.rendererBadgeInactive),
                ...(rendererToggleLocked ? styles.rendererBadgeDisabled : {}),
              }}
              title={rendererPref === 'webgpu' ? t('viewer.webgpu') : t('viewer.webgl2')}
              aria-label={rendererPref === 'webgpu' ? t('viewer.webgpu') : t('viewer.webgl2')}
            >
              {rendererPref === 'webgpu' ? 'WebGPU' : 'WebGL2'}
            </button>
          ) : (
            <span style={styles.featureBadgeOff} title={t('viewer.webgl2')}>
              WebGL2
            </span>
          )}
          <span style={styles.versionBadge}>v0.1.0</span>
        </div>

        <div style={styles.controlsGroup}>
          <LanguageSwitch />
          <button
            type="button"
            role="switch"
            aria-checked={theme === 'light'}
            aria-label={t('theme.switch', { theme: theme === 'light' ? t('theme.dark') : t('theme.light') })}
            title={t('theme.switch', { theme: theme === 'light' ? t('theme.dark') : t('theme.light') })}
            onClick={toggleTheme}
            style={styles.themeButton}
          >
            <ThemeIcon theme={theme} />
          </button>
          <select
            value={cameraMode}
            onChange={(e) => setCameraMode(e.target.value)}
            style={styles.selectInput}
            aria-label={t('viewer.camera')}
          >
            <option value="orbit">{t('viewer.orbit')}</option>
            <option value="fly">{t('viewer.fly')}</option>

            {manifest.viewer?.lockScene && <option value="locked">Locked</option>}
          </select>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            style={styles.selectInput}
            aria-label={t('viewer.quality')}
          >
            <option value="auto">{t('viewer.auto')}</option>
            <option value="low">{t('viewer.low')}</option>
            <option value="medium">{t('viewer.medium')}</option>
            <option value="high">{t('viewer.high')}</option>
          </select>
          {questPerfAllowed && (
            <button
              onClick={() => setQuestPerfPanelVisible(!showQuestPerf)}
              style={showQuestPerf ? styles.questPerfButtonActive : styles.vrButton}
              title={t('viewer.questPerfTitle')}
              aria-label={t('viewer.questPerfTitle')}
            >
              {t('viewer.questPerf')}
            </button>
          )}
          {adminCanCapturePreview && (
            <button
              onClick={handleTakePreview}
              disabled={!viewerReady || capturePreviewBusy}
              style={{
                ...styles.takePreviewButton,
                ...(!viewerReady || capturePreviewBusy ? styles.takePreviewButtonDisabled : {}),
              }}
              title={t('viewer.takePreview')}
              aria-label={t('viewer.takePreview')}
            >
              {capturePreviewBusy ? t('viewer.capturing') : t('viewer.takePreview')}
            </button>
          )}
          {manifest.viewer?.enableVr && vrSupported && (
            <button
              onClick={vrActive ? handleExitVr : handleEnterVr}
              disabled={vrLaunchPending}
              style={styles.vrButton}
              title={vrLaunchPending ? t('viewer.startingVr') : vrActive ? t('viewer.vr') : t('viewer.enterVr')}
              aria-label={vrActive ? t('viewer.vr') : t('viewer.enterVr')}
            >
              {vrLaunchPending ? t('viewer.startingVr') : t('viewer.vr')}
            </button>
          )}
          {manifest.viewer?.enableVr && vrChecked && !vrSupported && (
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
          <canvas key={`${rendererPref}-${assetVariant}`} ref={canvasRef} style={styles.canvas} />
        </div>

        {/* Annotation side panel (desktop), hidden on mobile. */}
        {false && selectedMarker && (
          <div style={styles.annotationPanel} role="complementary" aria-label={t('viewer.annotations')}>
            <div style={styles.annotationPanelHeader}>
              <h3 style={styles.annotationTitle}>{selectedMarker!.title}</h3>
              <button
                onClick={() => setSelectedMarker(null)}
                style={styles.closeButton}
                aria-label={t('viewer.close')}
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
        <div style={styles.annotationList} role="list" aria-label={t('viewer.annotations')}>
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
          <div style={styles.bottomSheet} role="dialog" aria-label={t('viewer.annotations')}>
            <div style={styles.bottomSheetHandle} />
            <div style={styles.annotationPanelHeader}>
              <h3 style={styles.annotationTitle}>{selectedMarker!.title}</h3>
              <button
                onClick={() => setSelectedMarker(null)}
                style={styles.closeButton}
                aria-label={t('viewer.close')}
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

      {questPerfAllowed && showQuestPerf && (
        <div style={styles.questPerfPanel} aria-label={t('viewer.questPerfTitle')} role="region">
          <div style={styles.questPerfHeader}>
            <span style={styles.questPerfTitle}>{t('viewer.questPerfTitle')}</span>
            <button
              onClick={() => setQuestPerfPanelVisible(false)}
              style={styles.questPerfClose}
              aria-label={t('viewer.closePanel')}
            >
              X
            </button>
          </div>
          <div style={styles.questPerfStatsGrid}>
            <span>Samples</span><strong>{questPerfSampleCount}</strong>
            <span>Run</span><strong>{questPerfExperiment}</strong>
            <span>p95</span><strong>{debugInfo.frameP95Ms || '-'}ms</strong>
            <span>Sort</span><strong>{debugInfo.sortTimeMs ? debugInfo.sortTimeMs.toFixed(1) : '-'}ms</strong>
            <span>GPU</span><strong>{debugInfo.gpuTimeMs ? debugInfo.gpuTimeMs.toFixed(1) : debugInfo.gpuTimerStatus}</strong>
            <span>CPU</span><strong>{debugInfo.cpuUpdateMs ? debugInfo.cpuUpdateMs.toFixed(1) : '-'}ms</strong>
            <span>LOD loads</span><strong>{debugInfo.lodLoadingCount}</strong>
            <span>Heap</span><strong>{debugInfo.gpuMemoryMB || '-'}MB</strong>
          </div>
          {questPerfVerdict && (
            <div style={styles.questPerfVerdict}>
              <strong>{questPerfVerdict.bottleneck}</strong>
              <span>{questPerfVerdict.confidence}</span>
              <p>{questPerfVerdict.summary}</p>
            </div>
          )}
          <div style={styles.questPerfActions}>
            <button
              onClick={() => questPerfCapturing ? stopQuestPerfCapture() : startQuestPerfCapture()}
              style={questPerfCapturing ? styles.questPerfDangerButton : styles.questPerfActionButton}
            >
              {questPerfCapturing ? t('viewer.stopCapture') : t('viewer.startCapture')}
            </button>
            <button
              onClick={runQuestPerfMatrix}
              disabled={questPerfCapturing}
              style={styles.questPerfActionButton}
            >
              {t('viewer.runMatrix')}
            </button>
            <button
              onClick={() => downloadQuestPerfTrace('csv')}
              disabled={!questPerfTrace}
              style={styles.questPerfActionButton}
            >
              {t('viewer.downloadCsv')}
            </button>
            <button
              onClick={() => downloadQuestPerfTrace('json')}
              disabled={!questPerfTrace}
              style={styles.questPerfActionButton}
            >
              {t('viewer.downloadJson')}
            </button>
            <button
              onClick={copyQuestPerfSummary}
              disabled={!questPerfTrace}
              style={styles.questPerfActionButton}
            >
              {questPerfCopied ? t('viewer.copied') : t('viewer.copy')}
            </button>
          </div>
        </div>
      )}

      {/* Debug overlay, toggle with ` key. */}
      {showDebug && (
        <div style={styles.debugOverlay} aria-label={t('viewer.debug')} role="region">
          <div style={styles.debugHeader}>
            <span style={styles.debugTitle}>🔍 Debug</span>
            <span style={styles.debugHint}>{t('viewer.hideDebug')}</span>
          </div>
          <div style={styles.debugGrid}>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>FPS</span>
              <span style={{ ...styles.debugValue, color: debugInfo.fps < 30 ? 'var(--color-error)' : 'var(--admin-success)' }}>{debugInfo.fps}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Frame</span>
              <span style={styles.debugValue}>{debugInfo.frameTimeMs}ms</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>p95</span>
              <span style={styles.debugValue}>{debugInfo.frameP95Ms || '-'}ms</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Sort</span>
              <span style={styles.debugValue}>{debugInfo.sortTimeMs ? debugInfo.sortTimeMs.toFixed(1) : '-'}ms</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>GPU</span>
              <span style={styles.debugValue}>{debugInfo.gpuTimeMs ? `${debugInfo.gpuTimeMs.toFixed(1)}ms` : debugInfo.gpuTimerStatus}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>CPU</span>
              <span style={styles.debugValue}>{debugInfo.cpuUpdateMs ? `${debugInfo.cpuUpdateMs.toFixed(1)}ms` : '-'}</span>
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
              <span style={styles.debugLabel}>Pipeline</span>
              <span style={styles.debugValue}>{debugInfo.rendererPipeline}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>{t('viewer.asset')}</span>
              <span style={styles.debugValue}>{debugInfo.assetFormat}{debugInfo.lodActive ? ' LOD' : ''}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Variant</span>
              <span style={styles.debugValue}>{debugInfo.assetVariant}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Phase</span>
              <span style={styles.debugValue}>{debugInfo.loadPhase}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>{t('viewer.quality')}</span>
              <span style={styles.debugValue}>{debugInfo.quality}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>DPR</span>
              <span style={styles.debugValue}>{debugInfo.devicePixelRatio.toFixed(2)}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Min px</span>
              <span style={styles.debugValue}>{debugInfo.minPixelSize.toFixed(2)}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Contrib</span>
              <span style={styles.debugValue}>{debugInfo.minContribution.toFixed(1)}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Alpha</span>
              <span style={styles.debugValue}>{debugInfo.alphaClip.toFixed(4)}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>LOD</span>
              <span style={styles.debugValue}>{debugInfo.lodRange}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>LOD loads</span>
              <span style={styles.debugValue}>{debugInfo.lodLoadingCount}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Scale</span>
              <span style={styles.debugValue}>{debugInfo.adaptiveQualityScale.toFixed(2)}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>On demand</span>
              <span style={styles.debugValue}>{debugInfo.renderOnDemand ? t('viewer.yes') : t('viewer.no')}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>XR</span>
              <span style={styles.debugValue}>{debugInfo.xrActive ? `${debugInfo.xrFrameRate || '-'}Hz` : t('viewer.off')}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>XR scale</span>
              <span style={styles.debugValue}>{debugInfo.xrFramebufferScale ? debugInfo.xrFramebufferScale.toFixed(2) : '-'}</span>
            </div>
            <div style={styles.debugRow}>
              <span style={styles.debugLabel}>Foveation</span>
              <span style={styles.debugValue}>{debugInfo.fixedFoveation === null ? '-' : debugInfo.fixedFoveation.toFixed(2)}</span>
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
    background: 'var(--color-viewer-bg)',
  },
  loadingText: {
    color: 'var(--color-ink-soft)',
    fontSize: '0.875rem',
  },
  errorContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    background: 'var(--color-viewer-bg)',
  },
  errorText: {
    color: 'var(--color-error)',
    fontSize: '0.875rem',
  },
  backLink: {
    color: 'var(--color-ink-soft)',
    textDecoration: 'underline',
    fontSize: '0.8125rem',
  },
  viewerContainer: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-viewer-bg)',
    position: 'relative',
  },
  posterOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    background: 'var(--color-viewer-bg)',
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
    background: 'var(--color-viewer-scrim)',
  },
  progressText: {
    color: 'var(--color-ink)',
    fontSize: '0.75rem',
    background: 'var(--color-viewer-overlay)',
    border: 'var(--rule)',
    borderRadius: 6,
    padding: '0.375rem 0.625rem',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--color-rule)',
    borderTopColor: 'var(--color-ink)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    flexWrap: 'wrap',
    padding: '0.75rem 1rem',
    background: 'var(--color-panel-solid)',
    borderBottom: 'var(--rule)',
    zIndex: 10,
    flexShrink: 0,
  },
  topBarLeft: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  backButton: {
    color: 'var(--color-ink-soft)',
    textDecoration: 'none',
    fontSize: '0.875rem',
  },
  sceneTitle: {
    minWidth: 0,
    color: 'var(--color-ink)',
    fontWeight: 600,
    fontSize: '0.9375rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  controlsGroup: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  themeButton: {
    width: 44,
    minHeight: 44,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 6,
    color: 'var(--color-ink-soft)',
    cursor: 'pointer',
  },
  selectInput: {
    padding: '0.375rem 0.75rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 6,
    color: 'var(--color-ink-soft)',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  vrButton: {
    padding: '0.375rem 0.75rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 6,
    color: 'var(--color-ink-soft)',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  questPerfButtonActive: {
    padding: '0.375rem 0.75rem',
    background: 'oklch(78% 0.13 145 / 0.12)',
    border: '1px solid var(--admin-success)',
    borderRadius: 6,
    color: 'var(--admin-success)',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  takePreviewButton: {
    padding: '0.375rem 0.75rem',
    background: 'var(--color-ink)',
    border: '1px solid var(--color-accent)',
    borderRadius: 6,
    color: 'var(--color-viewer-bg)',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 700,
  },
  takePreviewButtonDisabled: {
    opacity: 0.48,
    cursor: 'not-allowed',
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
    background: 'var(--color-panel-solid)',
    borderLeft: 'var(--rule)',
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
    color: 'var(--color-ink)',
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-muted)',
    cursor: 'pointer',
    fontSize: '1.25rem',
    padding: 0,
    lineHeight: 1,
  },
  annotationBody: {
    fontSize: '0.875rem',
    color: 'var(--color-ink-soft)',
    lineHeight: 1.5,
    margin: 0,
  },
  annotationMeta: {
    fontSize: '0.75rem',
    color: 'var(--color-muted)',
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  annotationKind: {
    padding: '0.125rem 0.5rem',
    border: 'var(--rule)',
    borderRadius: 4,
  },
  annotationCoords: {
    fontFamily: 'monospace',
  },
  annotationList: {
    padding: '0.5rem 1rem',
    background: 'var(--color-panel-solid)',
    borderTop: 'var(--rule)',
    display: 'flex',
    gap: '0.5rem',
    overflowX: 'auto',
    zIndex: 5,
    flexShrink: 0,
  },
  annotationChip: {
    padding: '0.375rem 0.75rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 6,
    color: 'var(--color-ink-soft)',
    cursor: 'pointer',
    fontSize: '0.75rem',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  // Feature badges
  featureBadgeOn: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: 'oklch(78% 0.13 145 / 0.12)',
    border: '1px solid var(--admin-success)',
    borderRadius: 4,
    color: 'var(--admin-success)',
    fontWeight: 600,
  },
  featureBadgeOff: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 4,
    color: 'var(--color-muted)',
  },
  // Clickable renderer toggle button
  rendererBadgeActive: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: 'oklch(78% 0.13 145 / 0.12)',
    border: '1px solid var(--admin-success)',
    borderRadius: 4,
    color: 'var(--admin-success)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  rendererBadgeInactive: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 4,
    color: 'var(--color-muted)',
    cursor: 'pointer',
  },
  rendererBadgeDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  versionBadge: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 4,
    color: 'var(--color-muted)',
    fontFamily: 'monospace',
    letterSpacing: '0.02em',
    userSelect: 'none' as const,
  },
  vrUnavailable: {
    fontSize: '0.625rem',
    padding: '0.125rem 0.5rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 4,
    color: 'var(--color-muted)',
    cursor: 'not-allowed',
  },
  // VR error toast
  vrErrorToast: {
    position: 'fixed' as const,
    top: '3.5rem',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    background: 'rgba(239, 68, 68, 0.92)',
    color: 'var(--color-accent-ink)',
    borderRadius: 6,
    fontSize: '0.75rem',
    fontWeight: 500,
    maxWidth: '90vw',
    animation: 'fadeIn 150ms ease',
  },
  vrErrorClose: {
    background: 'none',
    border: 'none',
    color: 'var(--color-accent-ink)',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: 0,
    lineHeight: 1,
    marginLeft: '0.25rem',
  },
  questPerfPanel: {
    position: 'fixed' as const,
    left: 12,
    bottom: 12,
    width: 340,
    maxWidth: 'calc(100vw - 24px)',
    background: 'var(--color-viewer-overlay)',
    border: 'var(--rule)',
    borderRadius: 8,
    padding: '0.75rem',
    zIndex: 55,
    color: 'var(--color-ink-soft)',
    fontSize: '0.75rem',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 18px 60px var(--color-shadow-strong)',
  },
  questPerfHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.625rem',
    paddingBottom: '0.5rem',
    borderBottom: 'var(--rule)',
  },
  questPerfTitle: {
    color: 'var(--color-ink)',
    fontWeight: 700,
  },
  questPerfClose: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-ink-soft)',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  questPerfStatsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '0.25rem 0.75rem',
    marginBottom: '0.625rem',
  },
  questPerfVerdict: {
    border: '1px solid var(--color-rule-strong)',
    background: 'var(--color-panel)',
    borderRadius: 6,
    padding: '0.5rem',
    marginBottom: '0.625rem',
    display: 'grid',
    gap: '0.25rem',
  },
  questPerfActions: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.375rem',
  },
  questPerfActionButton: {
    padding: '0.375rem 0.625rem',
    background: 'var(--color-panel)',
    border: 'var(--rule)',
    borderRadius: 6,
    color: 'var(--color-ink-soft)',
    cursor: 'pointer',
    fontSize: '0.72rem',
  },
  questPerfDangerButton: {
    padding: '0.375rem 0.625rem',
    background: 'oklch(70% 0.14 25 / 0.14)',
    border: '1px solid var(--color-error)',
    borderRadius: 6,
    color: 'var(--color-error)',
    cursor: 'pointer',
    fontSize: '0.72rem',
  },
  // Mobile bottom sheet
  bottomSheetOverlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'var(--color-viewer-scrim)',
    zIndex: 30,
    animation: 'fadeIn 150ms ease',
  },
  bottomSheet: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--color-panel-solid)',
    borderTop: 'var(--rule)',
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
    background: 'var(--color-rule)',
    borderRadius: 2,
    margin: '0 auto 0.75rem',
  },
  // Debug overlay
  debugOverlay: {
    position: 'fixed' as const,
    top: 60,
    right: 12,
    width: 220,
    background: 'var(--color-viewer-overlay)',
    border: 'var(--rule)',
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
    borderBottom: 'var(--rule)',
  },
  debugTitle: {
    color: 'var(--color-ink)',
    fontWeight: 600,
  },
  debugHint: {
    color: 'var(--color-muted)',
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
    color: 'var(--color-muted)',
  },
  debugValue: {
    color: 'var(--color-ink-soft)',
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



