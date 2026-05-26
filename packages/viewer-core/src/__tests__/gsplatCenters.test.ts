import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLodChunkUrls } from '../gsplatCenters.js';

describe('fetchLodChunkUrls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves relative chunk URLs against the lod manifest URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        filenames: ['chunks/0.sog', './chunks/1.ply', 'https://cdn.example.com/chunks/2.sog'],
      }),
    })));

    await expect(fetchLodChunkUrls('https://assets.example.com/scenes/demo/lod-meta.json')).resolves.toEqual([
      'https://assets.example.com/scenes/demo/chunks/0.sog',
      'https://assets.example.com/scenes/demo/chunks/1.ply',
      'https://cdn.example.com/chunks/2.sog',
    ]);
  });

  it('rejects malformed lod manifests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ files: [] }),
    })));

    await expect(fetchLodChunkUrls('https://assets.example.com/lod-meta.json')).rejects.toThrow(
      'LOD manifest did not include a filenames array',
    );
  });
});
