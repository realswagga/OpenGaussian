import { describe, expect, it } from 'vitest';
import {
  analyzeQuestPerfTrace,
  createDefaultQuestPerfExperiments,
  createQuestPerfSample,
  createQuestPerfTrace,
  exportQuestPerfCsv,
  exportQuestPerfJson,
} from '../questPerf.js';
import type { QuestPerfTrace } from '../questPerf.js';
import type { ViewerStats } from '../types.js';

function baseStats(overrides: Partial<ViewerStats> = {}): ViewerStats {
  return {
    fps: 72,
    rendererMode: 'webgl2',
    rendererBackend: 'playcanvas',
    rendererPipeline: 'raster-cpu-sort',
    quality: 'auto',
    splatBudget: 60_000,
    frameTimeMs: 13.9,
    activeSplats: 60_000,
    actualRenderedSplats: 60_000,
    canvasPixels: 1_000_000,
    loadPhase: 'complete',
    xrActive: true,
    xrFramebufferScale: 0.6,
    fixedFoveation: 1,
    gpuTimerStatus: 'unsupported',
    ...overrides,
  };
}

function addSample(trace: QuestPerfTrace, stats: Partial<ViewerStats>, experimentId?: string, experimentLabel?: string): void {
  trace.samples.push(createQuestPerfSample(baseStats(stats), {
    traceId: trace.id,
    sceneSlug: trace.sceneSlug,
    experimentId,
    experimentLabel,
    experimentPhase: experimentId ? 'capture' : undefined,
  }));
}

describe('quest performance tracing', () => {
  it('serializes traces to CSV and JSON with missing GPU timers intact', () => {
    const trace = createQuestPerfTrace({ sceneSlug: 'atrium', targetFps: 72, userAgent: 'Meta Quest 3' });
    addSample(trace, { fps: 60, frameTimeMs: 16.6, gpuTimerStatus: 'unsupported' });

    const csv = exportQuestPerfCsv(trace);
    const json = exportQuestPerfJson(trace);

    expect(trace.deviceLabel).toBe('quest-3');
    expect(csv).toContain('gpuTimerStatus');
    expect(csv).toContain('unsupported');
    expect(JSON.parse(json).samples).toHaveLength(1);
  });

  it('classifies fill-rate when pixel/foveation-style experiments improve frame time', () => {
    const trace = createQuestPerfTrace({ sceneSlug: 'indoor' });
    for (let i = 0; i < 6; i += 1) {
      addSample(trace, { fps: 38, frameTimeMs: 26, canvasPixels: 1_400_000 }, 'baseline', 'Baseline');
      addSample(trace, { fps: 64, frameTimeMs: 15, canvasPixels: 720_000, xrFramebufferScale: 0.45 }, 'xr-scale-0.45', 'XR scale 0.45');
    }

    const verdict = analyzeQuestPerfTrace(trace);

    expect(verdict.bottleneck).toBe('fill-rate');
    expect(verdict.confidence).toBe('high');
  });

  it('classifies sort when splat budget changes help and sort time is visible', () => {
    const trace = createQuestPerfTrace({ sceneSlug: 'garden' });
    for (let i = 0; i < 6; i += 1) {
      addSample(trace, { fps: 40, frameTimeMs: 25, sortTimeMs: 7, splatBudget: 90_000 }, 'baseline', 'Baseline');
      addSample(trace, { fps: 58, frameTimeMs: 17, sortTimeMs: 3, splatBudget: 30_000 }, 'budget-30000', 'Budget 30k');
    }

    const verdict = analyzeQuestPerfTrace(trace);

    expect(verdict.bottleneck).toBe('sort');
    expect(verdict.evidence.join(' ')).toContain('Budget 30k');
  });

  it('builds full and live-safe experiment matrices', () => {
    const full = createDefaultQuestPerfExperiments();
    const live = createDefaultQuestPerfExperiments({ includeRestartRequired: false });

    expect(full.some((experiment) => experiment.restartXrRequired)).toBe(true);
    expect(live.every((experiment) => !experiment.restartXrRequired)).toBe(true);
    expect(live[0]?.id).toBe('baseline');
  });
});
