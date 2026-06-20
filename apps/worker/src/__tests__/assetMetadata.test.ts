import { describe, expect, it } from 'vitest';
import { readHeaderSplatCount, readManifestSplatCount } from '../assetMetadata.js';

describe('exact splat metadata', () => {
  it('reads raw and compressed PLY vertex counts from the header', () => {
    const header = Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 3000000\nproperty float x\nend_header\n');
    expect(readHeaderSplatCount('ply', header)).toBe(3_000_000);
    expect(readHeaderSplatCount('compressed-ply', header)).toBe(3_000_000);
  });

  it('reads the SPZ point count', () => {
    const header = Buffer.alloc(16);
    header.write('NGSP', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(1_234_567, 8);
    expect(readHeaderSplatCount('spz', header)).toBe(1_234_567);
  });

  it('sums finest-level counts in a PlayCanvas LOD manifest', () => {
    expect(readManifestSplatCount({
      tree: {
        children: [
          { lods: { 0: { count: 120 }, 1: { count: 60 } } },
          { lods: { 0: { count: 80 }, 1: { count: 40 } } },
        ],
      },
    })).toBe(200);
  });
});
