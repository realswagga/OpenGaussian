import { describe, expect, it } from 'vitest';
import { pickMarkerPoint } from '../markerPlacement.js';

describe('pickMarkerPoint', () => {
  it('picks the front point when multiple points lie behind one another', () => {
    const hit = pickMarkerPoint({
      positions: new Float32Array([
        0, 0, 8,
        0, 0, 2,
        0, 0, 5,
      ]),
      rayOrigin: [0, 0, 0],
      rayDirection: [0, 0, 1],
      sceneRadius: 10,
    });

    expect(hit?.position).toEqual([0, 0, 2]);
    expect(hit?.pointIndex).toBe(1);
  });

  it('expands the radius enough for near-miss clicks', () => {
    const hit = pickMarkerPoint({
      positions: new Float32Array([0.2, 0, 4]),
      rayOrigin: [0, 0, 0],
      rayDirection: [0, 0, 1],
      sceneRadius: 10,
    });

    expect(hit?.position[0]).toBeCloseTo(0.2);
    expect(hit?.position[1]).toBe(0);
    expect(hit?.position[2]).toBe(4);
    expect(hit?.searchRadius).toBeGreaterThanOrEqual(0.2);
  });

  it('rejects points behind the camera', () => {
    const hit = pickMarkerPoint({
      positions: new Float32Array([0, 0, -1]),
      rayOrigin: [0, 0, 0],
      rayDirection: [0, 0, 1],
      sceneRadius: 10,
    });

    expect(hit).toBeNull();
  });

  it('returns no hit for empty or non-finite point arrays', () => {
    expect(pickMarkerPoint({
      positions: new Float32Array(),
      rayOrigin: [0, 0, 0],
      rayDirection: [0, 0, 1],
    })).toBeNull();

    expect(pickMarkerPoint({
      positions: new Float32Array([Number.POSITIVE_INFINITY, 0, 1]),
      rayOrigin: [0, 0, 0],
      rayDirection: [0, 0, 1],
    })).toBeNull();
  });

  it('applies snap after choosing the point-cloud hit', () => {
    const hit = pickMarkerPoint({
      positions: new Float32Array([
        0.26, 0.26, 3,
        0, 0, 4,
      ]),
      rayOrigin: [0.26, 0.26, 0],
      rayDirection: [0, 0, 1],
      sceneRadius: 10,
      snapValue: 0.5,
    });

    expect(hit?.pointIndex).toBe(0);
    expect(hit?.position).toEqual([0.5, 0.5, 3]);
  });
});
