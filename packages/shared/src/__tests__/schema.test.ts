import { describe, it, expect } from 'vitest';

// Simple schema validation utilities used across the platform
export interface MarkerPoint {
  id: string;
  title: string;
  body?: string;
  kind: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  icon?: string;
  color?: string;
}

export interface ViewerManifest {
  id: string;
  slug: string;
  title: string;
  assets: {
    format: string;
    sceneUrl: string;
    lodManifestUrl?: string;
    metaUrl?: string;
    posterUrl?: string;
  };
  viewer: {
    defaultCamera?: Record<string, unknown>;
    enableVr: boolean;
    enableWebGpu: boolean;
    quality: string;
    budgets: {
      desktop: number;
      mobile: number;
      vr: number;
    };
  };
}

export function validateMarkerPoint(data: unknown): data is MarkerPoint {
  if (!data || typeof data !== 'object') return false;
  const a = data as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    typeof a.title === 'string' &&
    Array.isArray(a.position) &&
    a.position.length === 3 &&
    typeof a.position[0] === 'number' &&
    typeof a.position[1] === 'number' &&
    typeof a.position[2] === 'number'
  );
}

export function validateViewerManifest(data: unknown): data is ViewerManifest {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.slug === 'string' &&
    typeof m.title === 'string' &&
    m.assets !== null &&
    typeof m.assets === 'object' &&
    typeof (m.assets as Record<string, unknown>).sceneUrl === 'string' &&
    m.viewer !== null &&
    typeof m.viewer === 'object'
  );
}

describe('MarkerPoint validation', () => {
  it('accepts a valid marker point', () => {
    const point: MarkerPoint = {
      id: 'marker-1',
      title: 'Living Room',
      kind: 'info',
      position: [1.0, 2.0, -3.0],
    };
    expect(validateMarkerPoint(point)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateMarkerPoint(null)).toBe(false);
  });

  it('rejects object without id', () => {
    expect(validateMarkerPoint({ title: 'Test', position: [0, 0, 0] })).toBe(false);
  });

  it('rejects object with non-array position', () => {
    expect(
      validateMarkerPoint({ id: 'a', title: 'X', position: '1,2,3' }),
    ).toBe(false);
  });

  it('rejects object with wrong position length', () => {
    expect(
      validateMarkerPoint({ id: 'a', title: 'X', position: [1, 2] }),
    ).toBe(false);
  });

  it('rejects object with string position values', () => {
    expect(
      validateMarkerPoint({ id: 'a', title: 'X', position: ['1', '2', '3'] }),
    ).toBe(false);
  });

  it('accepts marker with optional fields', () => {
    const full: MarkerPoint = {
      id: 'marker-1',
      title: 'Living Room',
      body: 'Bright living room',
      kind: 'info',
      position: [1.0, 2.0, -3.0],
      rotation: [0, 45, 0],
      scale: 1.5,
      icon: 'circle',
      color: '#ff4444',
    };
    expect(validateMarkerPoint(full)).toBe(true);
  });

  it('keeps AnnotationPoint as a compatibility alias', () => {
    const legacy: AnnotationPoint = {
      id: 'ann-1',
      title: 'Legacy',
      kind: 'info',
      position: [0, 0, 0],
    };
    expect(validateMarkerPoint(legacy)).toBe(true);
  });
});

describe('ViewerManifest validation', () => {
  const validManifest: ViewerManifest = {
    id: 'splat-1',
    slug: 'test-scene',
    title: 'Test Scene',
    assets: {
      format: 'ply',
      sceneUrl: '/assets/scene.ply',
    },
    viewer: {
      enableVr: true,
      enableWebGpu: true,
      quality: 'auto',
      budgets: { desktop: 900000, mobile: 250000, vr: 60000 },
    },
  };

  it('accepts valid manifest', () => {
    expect(validateViewerManifest(validManifest)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateViewerManifest(null)).toBe(false);
  });

  it('rejects manifest without assets', () => {
    const m = { ...validManifest, assets: undefined };
    expect(validateViewerManifest(m)).toBe(false);
  });

  it('rejects manifest without viewer', () => {
    const m = { ...validManifest, viewer: undefined };
    expect(validateViewerManifest(m)).toBe(false);
  });

  it('rejects manifest without sceneUrl', () => {
    const m = { ...validManifest, assets: { format: 'ply' } };
    expect(validateViewerManifest(m)).toBe(false);
  });

  it('accepts manifest with optional asset fields', () => {
    const m: ViewerManifest = {
      id: 'splat-2',
      slug: 'test-scene-2',
      title: 'Test Scene 2',
      assets: {
        format: 'sog',
        sceneUrl: '/assets/scene.sog',
        lodManifestUrl: '/assets/lod-meta.json',
        metaUrl: '/assets/scene.meta.json',
        posterUrl: '/assets/poster.png',
      },
      viewer: {
        defaultCamera: { position: [0, 0, 5] },
        enableVr: true,
        enableWebGpu: false,
        quality: 'high',
        budgets: { desktop: 2000000, mobile: 800000, vr: 900000 },
      },
    };
    expect(validateViewerManifest(m)).toBe(true);
  });
});
/** @deprecated Use MarkerPoint. */
export type AnnotationPoint = MarkerPoint;
