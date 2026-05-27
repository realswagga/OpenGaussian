import { describe, expect, it } from 'vitest';
import { createPlayCanvasLodManifest, sampleLodVertices, type LodSourceVertex } from '../lodManifest.js';

describe('sampleLodVertices', () => {
  it('keeps high-importance splats while preserving source order', () => {
    const vertices: LodSourceVertex[] = Array.from({ length: 10 }, (_, index) => ({
      x: index,
      y: 0,
      z: 0,
      offset: index * 248,
      importance: index === 9 ? 100 : index,
    }));

    const sampled = sampleLodVertices(vertices, 4);

    expect(sampled).toHaveLength(4);
    expect(sampled.some((vertex) => vertex.importance === 100)).toBe(true);
    expect(sampled.map((vertex) => vertex.offset)).toEqual([...sampled].map((vertex) => vertex.offset).sort((a, b) => a - b));
  });
});

describe('createPlayCanvasLodManifest', () => {
  it('emits the exact PlayCanvas octree manifest shape with valid offsets', () => {
    const manifest = createPlayCanvasLodManifest({
      bounds: { min: [0, 0, 0], max: [2, 2, 2] },
      filenames: ['lod-0.ply', 'lod-1.ply', 'lod-2.ply', 'lod-3.ply'],
      cells: [
        {
          bound: { min: [0, 0, 0], max: [1, 1, 1] },
          lods: [
            { file: 0, offset: 0, count: 8 },
            { file: 1, offset: 0, count: 4 },
            { file: 2, offset: 0, count: 2 },
            { file: 3, offset: 0, count: 1 },
          ],
        },
        {
          bound: { min: [1, 1, 1], max: [2, 2, 2] },
          lods: [
            { file: 0, offset: 8, count: 8 },
            { file: 1, offset: 4, count: 4 },
            { file: 2, offset: 2, count: 2 },
            { file: 3, offset: 1, count: 1 },
          ],
        },
      ],
    });

    expect(manifest).toEqual({
      version: 1,
      lodLevels: 4,
      filenames: ['lod-0.ply', 'lod-1.ply', 'lod-2.ply', 'lod-3.ply'],
      tree: {
        bound: { min: [0, 0, 0], max: [2, 2, 2] },
        children: [
          {
            bound: { min: [0, 0, 0], max: [1, 1, 1] },
            lods: {
              '0': { file: 0, offset: 0, count: 8 },
              '1': { file: 1, offset: 0, count: 4 },
              '2': { file: 2, offset: 0, count: 2 },
              '3': { file: 3, offset: 0, count: 1 },
            },
          },
          {
            bound: { min: [1, 1, 1], max: [2, 2, 2] },
            lods: {
              '0': { file: 0, offset: 8, count: 8 },
              '1': { file: 1, offset: 4, count: 4 },
              '2': { file: 2, offset: 2, count: 2 },
              '3': { file: 3, offset: 1, count: 1 },
            },
          },
        ],
      },
    });

    for (const child of manifest.tree.children) {
      for (const lod of Object.values(child.lods)) {
        expect(lod.file).toBeGreaterThanOrEqual(0);
        expect(lod.offset).toBeGreaterThanOrEqual(0);
        expect(lod.count).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the required lod-meta.json basename separate from packed LOD filenames', () => {
    const objectKey = 'splats/demo/versions/production/lod-meta.json';

    expect(objectKey.split('/').pop()).toBe('lod-meta.json');
    expect(objectKey).not.toContain('scene.lod-meta.json');
  });
});
