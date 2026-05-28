import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  center2D,
  classifyTwoPointerGesture,
  clampDollyStepToDepth,
  computeDepthConsensus,
  computeDepthAwareDollyStep,
  computeFrontDepthConsensus,
  computePinchScale,
  readGamepadStick,
} from '../navigationControls.js';

describe('navigationControls', () => {
  it('scales wheel movement by hit depth and clamps extremes', () => {
    expect(computeDepthAwareDollyStep({ deltaY: -100, hitDepth: 10, sceneRadius: 20 })).toBeCloseTo(1);
    expect(computeDepthAwareDollyStep({ deltaY: 100, hitDepth: 10, sceneRadius: 20 })).toBeCloseTo(-1);
    expect(computeDepthAwareDollyStep({ deltaY: -10000, hitDepth: 1000, sceneRadius: 10 })).toBeCloseTo(2.5);
    expect(computeDepthAwareDollyStep({ deltaY: -1, hitDepth: 0.01, sceneRadius: 10 })).toBeCloseTo(0.02);
  });

  it('classifies two-pointer scale before pan', () => {
    const previousCenter = center2D({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(classifyTwoPointerGesture({
      previousDistance: 10,
      currentDistance: 18,
      previousCenter,
      currentCenter: { x: 15, y: 0 },
    })).toBe('dolly');

    expect(classifyTwoPointerGesture({
      previousDistance: 10,
      currentDistance: 11,
      previousCenter,
      currentCenter: { x: 8, y: 0 },
    })).toBe('pan');
  });

  it('derives a confidence-scored median depth from nearby ray samples', () => {
    expect(computeDepthConsensus({
      samples: [9.8, 10, 10.2, 40],
      fallbackDepth: 5,
      minSamples: 3,
    })).toMatchObject({
      distance: 10.1,
      sampleCount: 4,
    });

    expect(computeDepthConsensus({
      samples: [],
      fallbackDepth: 7,
    })).toMatchObject({
      distance: 7,
      confidence: 0,
      sampleCount: 0,
    });

    const stable = computeDepthConsensus({ samples: [9.9, 10, 10.1], fallbackDepth: 3 });
    const scattered = computeDepthConsensus({ samples: [3, 10, 80], fallbackDepth: 3 });
    expect(stable.confidence).toBeGreaterThan(scattered.confidence);
  });

  it('prefers the nearest coherent front depth cluster over background samples', () => {
    const consensus = computeFrontDepthConsensus({
      samples: [1, 1.08, 1.12, 7.8, 8, 8.2, 8.4],
      fallbackDepth: 4,
      minSamples: 3,
      minClusterSamples: 2,
      maxClusterRelativeSpread: 0.25,
    });

    expect(consensus.distance).toBeCloseTo(1.08);
    expect(consensus.sampleCount).toBe(3);
    expect(consensus.confidence).toBeGreaterThan(0.5);
  });

  it('clamps forward dolly steps before crossing the picked surface', () => {
    expect(clampDollyStepToDepth({
      step: 2,
      hitDepth: 3,
      sceneRadius: 10,
      nearSurfaceStop: 0.5,
      forwardLimitRatio: 0.35,
    })).toBeCloseTo(1.05);

    expect(computeDepthAwareDollyStep({
      deltaY: -100,
      hitDepth: 0.2,
      sceneRadius: 10,
      nearSurfaceStop: 0.08,
      forwardLimitRatio: 0.35,
    })).toBeLessThanOrEqual(0.07);

    expect(clampDollyStepToDepth({
      step: -2,
      hitDepth: 0.2,
      sceneRadius: 10,
      nearSurfaceStop: 0.08,
      forwardLimitRatio: 0.35,
    })).toBe(-2);
  });

  it('normalizes deadzones and reads WebXR stick fallback axes', () => {
    expect(applyDeadzone(0.1)).toBe(0);
    expect(applyDeadzone(1)).toBe(1);
    expect(readGamepadStick({ axes: [0.5, -0.5, 0, 0] as unknown as readonly number[] }).source).toBe('primary');
    expect(readGamepadStick({ axes: [0, 0, -0.5, 0.5] as unknown as readonly number[] })).toMatchObject({
      source: 'secondary',
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });

  it('clamps pinch scale', () => {
    expect(computePinchScale(10, 20)).toBe(2);
    expect(computePinchScale(10, 100)).toBe(4);
    expect(computePinchScale(10, 1)).toBe(0.25);
    expect(computePinchScale(0, 10)).toBe(1);
  });
});
