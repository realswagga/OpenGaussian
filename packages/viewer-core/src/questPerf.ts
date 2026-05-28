import type { AssetVariantName, SplatAssetFormat, ViewerLoadPhase, ViewerStats, WebgpuPipelineMode } from './types.js';

export type QuestPerfBottleneck =
  | 'unknown'
  | 'cpu'
  | 'sort'
  | 'fill-rate'
  | 'lod-streaming'
  | 'memory-gc'
  | 'thermal'
  | 'mixed';

export type QuestPerfExperimentPhase = 'idle' | 'warmup' | 'capture' | 'complete';

export interface QuestPerfCpuBuckets {
  totalUpdateMs?: number;
  adaptiveQualityMs?: number;
  renderPolicyMs?: number;
  cameraInputMs?: number;
  vrLocomotionMs?: number;
  markerGizmoMs?: number;
  statsEmitMs?: number;
}

export interface QuestPerfQualityFlags {
  antialias: boolean;
  highQualitySH: boolean;
  radialSorting: boolean;
  renderOnDemand: boolean;
  markersVisible: boolean;
}

export interface QuestPerfCameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface QuestPerfRuntimeOverrides {
  splatBudget?: number;
  xrFramebufferScale?: number;
  xrFixedFoveation?: number;
  highQualitySH?: boolean;
  minPixelSize?: number;
  minContribution?: number;
  radialSorting?: boolean;
  markersVisible?: boolean;
}

export interface QuestPerfSample {
  traceId: string;
  timestampMs: number;
  wallTimeIso: string;
  sceneId?: string;
  sceneSlug?: string;
  experimentId?: string;
  experimentLabel?: string;
  experimentPhase?: QuestPerfExperimentPhase;
  rendererMode: 'webgl2' | 'webgpu';
  rendererPipeline?: WebgpuPipelineMode;
  assetFormat?: SplatAssetFormat;
  assetVariant?: AssetVariantName | 'base';
  loadPhase?: ViewerLoadPhase;
  fps: number;
  frameTimeMs?: number;
  frameP50Ms?: number;
  frameP95Ms?: number;
  frameP99Ms?: number;
  sortTimeMs?: number;
  gpuTimeMs?: number;
  gpuTimerStatus?: string;
  cpu?: QuestPerfCpuBuckets;
  canvasPixels?: number;
  devicePixelRatio?: number;
  xrActive?: boolean;
  xrFrameRate?: number;
  xrFramebufferScale?: number;
  fixedFoveation?: number | null;
  totalSplats?: number;
  activeSplats?: number;
  actualRenderedSplats?: number;
  splatBudget: number;
  lodActive?: boolean;
  lodLoadingCount?: number;
  minPixelSize?: number;
  minContribution?: number;
  alphaClip?: number;
  adaptiveQualityScale?: number;
  jsHeapUsedMB?: number;
  jsHeapTotalMB?: number;
  camera?: QuestPerfCameraPose;
  qualityFlags?: QuestPerfQualityFlags;
}

export interface QuestPerfTrace {
  id: string;
  startedAt: string;
  endedAt?: string;
  sceneId?: string;
  sceneSlug?: string;
  userAgent?: string;
  deviceLabel: 'quest-3' | 'quest' | 'desktop' | 'mobile' | 'unknown';
  targetFps: number;
  targetFrameTimeMs: number;
  samples: QuestPerfSample[];
  notes?: string[];
}

export interface QuestPerfVerdict {
  bottleneck: QuestPerfBottleneck;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  evidence: string[];
  recommendations: string[];
}

export interface QuestPerfExperiment {
  id: string;
  label: string;
  warmupMs: number;
  captureMs: number;
  overrides: QuestPerfRuntimeOverrides;
  restartXrRequired?: boolean;
}

export interface QuestPerfTraceInput {
  sceneId?: string;
  sceneSlug?: string;
  targetFps?: number;
  userAgent?: string;
  deviceLabel?: QuestPerfTrace['deviceLabel'];
}

export interface QuestPerfSampleContext {
  traceId: string;
  sceneId?: string;
  sceneSlug?: string;
  experimentId?: string;
  experimentLabel?: string;
  experimentPhase?: QuestPerfExperimentPhase;
  timestampMs?: number;
}

const CSV_FIELDS: Array<keyof QuestPerfSample | string> = [
  'traceId',
  'wallTimeIso',
  'timestampMs',
  'sceneSlug',
  'experimentId',
  'experimentPhase',
  'rendererMode',
  'rendererPipeline',
  'assetFormat',
  'assetVariant',
  'loadPhase',
  'fps',
  'frameTimeMs',
  'frameP50Ms',
  'frameP95Ms',
  'frameP99Ms',
  'sortTimeMs',
  'gpuTimeMs',
  'gpuTimerStatus',
  'cpu.totalUpdateMs',
  'cpu.adaptiveQualityMs',
  'cpu.renderPolicyMs',
  'cpu.cameraInputMs',
  'cpu.vrLocomotionMs',
  'cpu.markerGizmoMs',
  'canvasPixels',
  'devicePixelRatio',
  'xrActive',
  'xrFrameRate',
  'xrFramebufferScale',
  'fixedFoveation',
  'totalSplats',
  'activeSplats',
  'actualRenderedSplats',
  'splatBudget',
  'lodActive',
  'lodLoadingCount',
  'minPixelSize',
  'minContribution',
  'alphaClip',
  'adaptiveQualityScale',
  'jsHeapUsedMB',
  'qualityFlags.antialias',
  'qualityFlags.highQualitySH',
  'qualityFlags.radialSorting',
  'qualityFlags.renderOnDemand',
  'qualityFlags.markersVisible',
];

export function createQuestPerfTrace(input: QuestPerfTraceInput = {}): QuestPerfTrace {
  const targetFps = input.targetFps ?? 72;
  return {
    id: createTraceId(input.sceneSlug),
    startedAt: new Date().toISOString(),
    sceneId: input.sceneId,
    sceneSlug: input.sceneSlug,
    userAgent: input.userAgent,
    deviceLabel: input.deviceLabel ?? detectQuestPerfDevice(input.userAgent),
    targetFps,
    targetFrameTimeMs: 1000 / targetFps,
    samples: [],
  };
}

export function createQuestPerfSample(stats: ViewerStats, context: QuestPerfSampleContext): QuestPerfSample {
  const timestampMs = context.timestampMs ?? nowMs();
  return {
    traceId: context.traceId,
    timestampMs,
    wallTimeIso: new Date().toISOString(),
    sceneId: context.sceneId,
    sceneSlug: context.sceneSlug,
    experimentId: context.experimentId,
    experimentLabel: context.experimentLabel,
    experimentPhase: context.experimentPhase,
    rendererMode: stats.rendererMode,
    rendererPipeline: stats.rendererPipeline,
    assetFormat: stats.assetFormat,
    assetVariant: stats.activeAssetVariant,
    loadPhase: stats.loadPhase,
    fps: stats.fps,
    frameTimeMs: stats.frameTimeMs,
    frameP50Ms: stats.frameP50Ms,
    frameP95Ms: stats.frameP95Ms,
    frameP99Ms: stats.frameP99Ms,
    sortTimeMs: stats.sortTimeMs,
    gpuTimeMs: stats.gpuTimeMs,
    gpuTimerStatus: stats.gpuTimerStatus,
    cpu: stats.cpu,
    canvasPixels: stats.canvasPixels,
    devicePixelRatio: stats.devicePixelRatio,
    xrActive: stats.xrActive,
    xrFrameRate: stats.xrFrameRate,
    xrFramebufferScale: stats.xrFramebufferScale,
    fixedFoveation: stats.fixedFoveation,
    totalSplats: stats.totalSplats,
    activeSplats: stats.activeSplats,
    actualRenderedSplats: stats.actualRenderedSplats,
    splatBudget: stats.splatBudget,
    lodActive: stats.lodActive,
    lodLoadingCount: stats.lodLoadingCount,
    minPixelSize: stats.minPixelSize,
    minContribution: stats.minContribution,
    alphaClip: stats.alphaClip,
    adaptiveQualityScale: stats.adaptiveQualityScale,
    jsHeapUsedMB: stats.jsHeapUsedMB,
    jsHeapTotalMB: stats.jsHeapTotalMB,
    camera: stats.camera,
    qualityFlags: stats.qualityFlags,
  };
}

export function appendQuestPerfSample(trace: QuestPerfTrace, sample: QuestPerfSample, maxSamples = 60_000): QuestPerfTrace {
  trace.samples.push(sample);
  if (trace.samples.length > maxSamples) {
    trace.samples.splice(0, trace.samples.length - maxSamples);
  }
  return trace;
}

export function exportQuestPerfCsv(trace: QuestPerfTrace): string {
  const header = CSV_FIELDS.join(',');
  const rows = trace.samples.map((sample) => CSV_FIELDS.map((field) => csvCell(readPath(sample, String(field)))).join(','));
  return [header, ...rows].join('\n');
}

export function exportQuestPerfJson(trace: QuestPerfTrace): string {
  return `${JSON.stringify(trace, null, 2)}\n`;
}

export function summarizeQuestPerfTrace(trace: QuestPerfTrace, verdict = analyzeQuestPerfTrace(trace)): string {
  const samples = trace.samples;
  const avgFps = average(samples.map((sample) => sample.fps));
  const p95Frame = percentile(samples.map((sample) => sample.frameTimeMs), 0.95) ?? 0;
  const active = Math.round(average(samples.map((sample) => sample.actualRenderedSplats ?? sample.activeSplats)));
  return [
    `Quest perf ${trace.id}`,
    `${trace.sceneSlug || trace.sceneId || 'scene'}: ${Math.round(avgFps)} fps avg, ${formatNumber(p95Frame)} ms p95, ${active.toLocaleString()} active splats`,
    `${verdict.bottleneck} (${verdict.confidence}): ${verdict.summary}`,
  ].join(' | ');
}

export function analyzeQuestPerfTrace(trace: QuestPerfTrace): QuestPerfVerdict {
  const samples = trace.samples.filter((sample) => sample.experimentPhase !== 'warmup');
  if (samples.length < 3) {
    return {
      bottleneck: 'unknown',
      confidence: 'low',
      summary: 'Not enough samples to classify the bottleneck.',
      evidence: [`${samples.length} usable samples captured`],
      recommendations: ['Capture at least 20 seconds while looking at the slow area.'],
    };
  }

  const targetFrame = trace.targetFrameTimeMs || 13.9;
  const avgFrame = average(samples.map((sample) => sample.frameTimeMs));
  const p95Frame = percentile(samples.map((sample) => sample.frameTimeMs), 0.95) ?? 0;
  const avgSort = average(samples.map((sample) => sample.sortTimeMs));
  const avgCpu = average(samples.map((sample) => sample.cpu?.totalUpdateMs));
  const avgMarker = average(samples.map((sample) => sample.cpu?.markerGizmoMs));
  const avgGpu = average(samples.map((sample) => sample.gpuTimeMs));
  const avgLodLoading = average(samples.map((sample) => sample.lodLoadingCount));
  const heapGrowth = heapGrowthMB(samples);
  const fpsTrend = trend(samples.map((sample) => sample.fps));
  const fillSignal = compareExperimentDelta(samples, 'xrFramebufferScale')
    || compareExperimentDelta(samples, 'xrFixedFoveation')
    || compareExperimentDelta(samples, 'minPixelSize')
    || compareExperimentDelta(samples, 'minContribution');
  const budgetSignal = compareExperimentDelta(samples, 'splatBudget');
  const shSignal = compareExperimentDelta(samples, 'highQualitySH');
  const markerSignal = compareExperimentDelta(samples, 'markersVisible');
  const evidence: string[] = [
    `Average frame ${formatNumber(avgFrame)} ms; p95 ${formatNumber(p95Frame)} ms; target ${formatNumber(targetFrame)} ms`,
  ];

  if (avgGpu > 0) evidence.push(`Average GPU timer ${formatNumber(avgGpu)} ms`);
  if (avgCpu > 0) evidence.push(`Average JS update bucket ${formatNumber(avgCpu)} ms`);
  if (avgSort > 0) evidence.push(`Average sort time ${formatNumber(avgSort)} ms`);
  if (avgLodLoading > 0.2) evidence.push(`LOD loading active in ${formatNumber(avgLodLoading)} chunks on average`);
  if (heapGrowth > 16) evidence.push(`JS heap grew by ${formatNumber(heapGrowth)} MB during capture`);

  if (fillSignal) {
    evidence.push(fillSignal.evidence);
    return verdict('fill-rate', fillSignal.confidence, 'Pixel/foveation/culling changes moved frame time the most.', evidence, [
      'Lower XR framebuffer scale or keep Quest balanced at 0.60.',
      'Keep fixed foveation high for indoor scenes.',
      'Increase min pixel size/contribution clipping and use more aggressive VR LODs.',
    ]);
  }

  if (avgLodLoading > 0.7 && p95Frame > targetFrame * 1.2) {
    return verdict('lod-streaming', 'medium', 'Frame spikes align with LOD refinement/loading activity.', evidence, [
      'Preload the VR LOD variant before entering VR.',
      'Use coarser VR LOD ranges and smaller chunks for indoor movement.',
      'Keep the camera route stable while collecting fill-rate tests.',
    ]);
  }

  if (budgetSignal && avgSort > 1.5) {
    evidence.push(budgetSignal.evidence);
    return verdict('sort', budgetSignal.confidence, 'Splat count changes dominate and sort time is visible.', evidence, [
      'Lower the Quest splat budget and make VR variants more aggressive.',
      'Prefer LOD/SOG variants that keep active splats below the observed cliff.',
      'Keep CPU sort as production VR until WebXR-WebGPU is reliable.',
    ]);
  }

  if (avgSort > targetFrame * 0.25) {
    return verdict('sort', 'medium', 'Sort time consumes a large part of the VR frame budget.', evidence, [
      'Reduce active splats before tuning shader quality.',
      'Benchmark radial sorting against linear sorting for this scene.',
    ]);
  }

  if (avgCpu > targetFrame * 0.25 || markerSignal || avgMarker > 1) {
    if (markerSignal) evidence.push(markerSignal.evidence);
    return verdict('cpu', markerSignal?.confidence ?? 'medium', 'JS/update-side work is large enough to threaten the frame budget.', evidence, [
      'Keep marker/gizmo updates disabled in VR.',
      'Profile update buckets in Chrome remote devtools after reproducing the slow area.',
    ]);
  }

  if (heapGrowth > 32 && p95Frame > targetFrame * 1.25) {
    return verdict('memory-gc', 'medium', 'Heap growth and frame spikes suggest allocation or browser memory pressure.', evidence, [
      'Check for per-frame allocations and delayed asset cleanup.',
      'Compare SOG/LOD variants for lower memory footprint.',
    ]);
  }

  if (fpsTrend < -0.08 && samples.length > 30) {
    evidence.push(`FPS trend falls ${formatNumber(Math.abs(fpsTrend) * 100)}% over the capture`);
    return verdict('thermal', 'low', 'Performance decays over time; confirm with OVR heat/throttle metrics.', evidence, [
      'Run the same capture with OVR Metrics heat and CPU/GPU level fields visible.',
      'Repeat after headset cooldown to separate scene cost from thermal throttling.',
    ]);
  }

  if (shSignal) {
    evidence.push(shSignal.evidence);
    return verdict('mixed', shSignal.confidence, 'Quality flags affect performance, but no single hardware bottleneck dominates yet.', evidence, [
      'Keep SH disabled in Quest VR unless the scene proves CPU/GPU headroom.',
      'Run the live matrix while looking at the densest indoor wall.',
    ]);
  }

  return verdict('unknown', 'low', 'The trace is over budget but lacks a strong single signal.', evidence, [
    'Run the live matrix and pair the trace with OVR Metrics CSV.',
    'Capture a fixed-pose dense-wall sample and a movement sample separately.',
  ]);
}

export function createDefaultQuestPerfExperiments(options: { includeRestartRequired?: boolean } = {}): QuestPerfExperiment[] {
  const warmupMs = 5_000;
  const captureMs = 20_000;
  const experiments: QuestPerfExperiment[] = [
    { id: 'baseline', label: 'Baseline', warmupMs, captureMs, overrides: {} },
    ...[0.45, 0.55, 0.6, 0.7].map((value): QuestPerfExperiment => ({
      id: `xr-scale-${value}`,
      label: `XR scale ${value}`,
      warmupMs,
      captureMs,
      restartXrRequired: true,
      overrides: { xrFramebufferScale: value },
    })),
    ...[0, 0.66, 1].map((value): QuestPerfExperiment => ({
      id: `foveation-${value}`,
      label: `Foveation ${value}`,
      warmupMs,
      captureMs,
      overrides: { xrFixedFoveation: value },
    })),
    ...[30_000, 45_000, 60_000, 90_000].map((value): QuestPerfExperiment => ({
      id: `budget-${value}`,
      label: `Budget ${Math.round(value / 1000)}k`,
      warmupMs,
      captureMs,
      overrides: { splatBudget: value },
    })),
    { id: 'sh-off', label: 'SH off', warmupMs, captureMs, overrides: { highQualitySH: false } },
    { id: 'sh-on', label: 'SH on', warmupMs, captureMs, overrides: { highQualitySH: true } },
    { id: 'min-pixel-6', label: 'Min pixel 6', warmupMs, captureMs, overrides: { minPixelSize: 6 } },
    { id: 'min-contribution-18', label: 'Contribution 18', warmupMs, captureMs, overrides: { minContribution: 18 } },
    { id: 'radial-off', label: 'Radial sort off', warmupMs, captureMs, overrides: { radialSorting: false } },
    { id: 'radial-on', label: 'Radial sort on', warmupMs, captureMs, overrides: { radialSorting: true } },
    { id: 'markers-off', label: 'Markers off', warmupMs, captureMs, overrides: { markersVisible: false } },
    { id: 'markers-on', label: 'Markers on', warmupMs, captureMs, overrides: { markersVisible: true } },
  ];

  if (options.includeRestartRequired === false) {
    return experiments.filter((experiment) => !experiment.restartXrRequired);
  }
  return experiments;
}

export function computeQuestPerfPercentiles(values: Array<number | undefined>, percentiles = [0.5, 0.95, 0.99]): Record<string, number | undefined> {
  const result: Record<string, number | undefined> = {};
  for (const value of percentiles) {
    result[`p${Math.round(value * 100)}`] = percentile(values, value);
  }
  return result;
}

function verdict(
  bottleneck: QuestPerfBottleneck,
  confidence: QuestPerfVerdict['confidence'],
  summary: string,
  evidence: string[],
  recommendations: string[],
): QuestPerfVerdict {
  return { bottleneck, confidence, summary, evidence, recommendations };
}

function compareExperimentDelta(samples: QuestPerfSample[], key: keyof QuestPerfRuntimeOverrides): { evidence: string; confidence: QuestPerfVerdict['confidence'] } | null {
  const baseline = samples.filter((sample) => sample.experimentId === 'baseline' || !sample.experimentId);
  const variants = samples.filter((sample) => sample.experimentId && sample.experimentId !== 'baseline');
  if (baseline.length < 2 || variants.length < 2) return null;
  const baselineFrame = average(baseline.map((sample) => sample.frameTimeMs));
  if (!Number.isFinite(baselineFrame) || baselineFrame <= 0) return null;

  let bestDelta = 0;
  let bestLabel = '';
  for (const group of groupBy(variants, (sample) => sample.experimentId || 'variant')) {
    const first = group[0];
    if (!first) continue;
    if (!experimentMatches(first, key)) continue;
    const variantFrame = average(group.map((sample) => sample.frameTimeMs));
    const delta = baselineFrame - variantFrame;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestLabel = first.experimentLabel || first.experimentId || key;
    }
  }

  if (bestDelta < Math.max(1, baselineFrame * 0.08)) return null;
  return {
    confidence: bestDelta > baselineFrame * 0.18 ? 'high' : 'medium',
    evidence: `${bestLabel} improved frame time by ${formatNumber(bestDelta)} ms versus baseline`,
  };
}

function experimentMatches(sample: QuestPerfSample, key: keyof QuestPerfRuntimeOverrides): boolean {
  const id = sample.experimentId || '';
  if (key === 'splatBudget') return id.startsWith('budget-');
  if (key === 'xrFramebufferScale') return id.startsWith('xr-scale-');
  if (key === 'xrFixedFoveation') return id.startsWith('foveation-');
  if (key === 'highQualitySH') return id.startsWith('sh-');
  if (key === 'minPixelSize') return id.startsWith('min-pixel-');
  if (key === 'minContribution') return id.startsWith('min-contribution-');
  if (key === 'radialSorting') return id.startsWith('radial-');
  if (key === 'markersVisible') return id.startsWith('markers-');
  return false;
}

function heapGrowthMB(samples: QuestPerfSample[]): number {
  const heaps = samples.map((sample) => sample.jsHeapUsedMB).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (heaps.length < 2) return 0;
  return Math.max(0, heaps[heaps.length - 1]! - heaps[0]!);
}

function groupBy<T>(items: T[], getKey: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function percentile(values: Array<number | undefined>, p: number): number | undefined {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return undefined;
  const index = Math.min(finite.length - 1, Math.max(0, Math.ceil(p * finite.length) - 1));
  return finite[index];
}

function average(values: Array<number | undefined>): number {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function trend(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value) && value > 0);
  if (finite.length < 4) return 0;
  const head = average(finite.slice(0, Math.max(2, Math.floor(finite.length * 0.25))));
  const tail = average(finite.slice(Math.max(0, finite.length - Math.max(2, Math.floor(finite.length * 0.25)))));
  if (head <= 0) return 0;
  return (tail - head) / head;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function createTraceId(sceneSlug?: string): string {
  const safeSlug = (sceneSlug || 'scene').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scene';
  return `${safeSlug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function detectQuestPerfDevice(userAgent?: string): QuestPerfTrace['deviceLabel'] {
  const ua = userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (/Quest 3/i.test(ua)) return 'quest-3';
  if (/Quest/i.test(ua)) return 'quest';
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return 'mobile';
  if (ua) return 'desktop';
  return 'unknown';
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return String(Math.round(value * 10) / 10);
}
