import { describe, expect, it } from 'vitest';
import { horizontalYawDeltaDegrees, intersectRaySphereDistance, pickVrMarkerByRay } from '../vrInteraction.js';

describe('VR marker interaction', () => {
  it('finds the nearest marker intersected by a controller ray', () => {
    const hit = pickVrMarkerByRay(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      [
        { id: 'far', center: { x: 0, y: 0, z: -4 }, radius: 0.2 },
        { id: 'near', center: { x: 0, y: 0, z: -2 }, radius: 0.2 },
      ],
    );

    expect(hit?.id).toBe('near');
    expect(hit?.distance).toBeCloseTo(1.8);
  });

  it('rejects markers behind or outside the pointing ray', () => {
    expect(intersectRaySphereDistance(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 2 },
      0.2,
    )).toBeNull();
    expect(pickVrMarkerByRay(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      [{ id: 'miss', center: { x: 1, y: 0, z: -2 }, radius: 0.2 }],
    )).toBeNull();
  });

  it('computes the shortest horizontal alignment to the saved camera target', () => {
    expect(horizontalYawDeltaDegrees(
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
    )).toBeCloseTo(-90);
    expect(horizontalYawDeltaDegrees(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
    )).toBeCloseTo(0);
  });
});
