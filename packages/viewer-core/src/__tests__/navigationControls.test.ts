import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  center2D,
  classifyTwoPointerGesture,
  computeDepthConsensus,
  computeDepthAwareDollyStep,
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
