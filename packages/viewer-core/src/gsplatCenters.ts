import {
  AppBase,
  AppOptions,
  Asset,
  BinaryHandler,
  ContainerHandler,
  createGraphicsDevice,
  GSplatHandler,
  TextureHandler,
  type GraphicsDevice,
} from 'playcanvas';
import { resolveViewerAsset, type ResolvedViewerAsset, type ViewerManifest } from './types.js';

interface LodMetaFile {
  filenames?: unknown;
}

class GsplatLoaderApp extends AppBase {
  constructor(canvas: HTMLCanvasElement, graphicsDevice: GraphicsDevice) {
    super(canvas);

    const appOptions = new AppOptions();
    appOptions.graphicsDevice = graphicsDevice;
    appOptions.resourceHandlers = [
      ContainerHandler,
      TextureHandler,
      GSplatHandler,
      BinaryHandler,
    ];
    this.init(appOptions);
  }
}

function filenameFromUrl(url: string): string {
  try {
    return new URL(url, window.location.href).pathname.split('/').pop() || 'scene';
  } catch {
    return url.split('/').pop() || 'scene';
  }
}

function cloneCenters(centers: Float32Array): Float32Array {
  return new Float32Array(centers);
}

function readCentersFromResource(value: unknown): Float32Array | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (record.centers instanceof Float32Array) {
    return cloneCenters(record.centers);
  }

  if (record.gsplatData && typeof record.gsplatData === 'object') {
    const gsplatData = record.gsplatData as { getCenters?: () => Float32Array };
    if (typeof gsplatData.getCenters === 'function') {
      return cloneCenters(gsplatData.getCenters());
    }
  }

  for (const key of ['resource', 'data', 'splatData', 'gsplat', 'lodResource']) {
    const nested = readCentersFromResource(record[key]);
    if (nested) return nested;
  }

  return null;
}

async function fetchMetaJson(url: string): Promise<object> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GSplat metadata fetch failed: HTTP ${response.status} for ${url}`);
  }

  const data = await response.json();
  if (!data || typeof data !== 'object') {
    throw new Error(`GSplat metadata response was not a JSON object for ${url}`);
  }

  return data;
}

async function fetchLodChunkUrls(url: string): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`LOD manifest fetch failed: HTTP ${response.status} for ${url}`);
  }

  const data = await response.json() as LodMetaFile;
  if (!Array.isArray(data.filenames)) {
    throw new Error(`LOD manifest did not include a filenames array for ${url}`);
  }

  return data.filenames
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .map((entry) => new URL(entry, url).toString());
}

function concatCenterArrays(centerArrays: Float32Array[]): Float32Array {
  const totalLength = centerArrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const centers of centerArrays) {
    result.set(centers, offset);
    offset += centers.length;
  }

  return result;
}

function sanitizeCenters(centers: Float32Array, url: string): Float32Array {
  const filtered: number[] = [];

  for (let i = 0; i < centers.length; i += 3) {
    const x = centers[i];
    const y = centers[i + 1];
    const z = centers[i + 2];

    if (
      x === undefined || y === undefined || z === undefined ||
      !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
    ) {
      continue;
    }

    // Guard against corrupted splat centers blowing up camera framing.
    if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000 || Math.abs(z) > 1_000_000) {
      continue;
    }

    filtered.push(x, y, z);
  }

  if (filtered.length === 0) {
    throw new Error(`No valid splat centers were extracted from ${url}`);
  }

  return new Float32Array(filtered);
}

async function loadSingleGsplatCenters(app: GsplatLoaderApp, url: string, source: ResolvedViewerAsset['source']): Promise<Float32Array> {
  const filename = filenameFromUrl(url);
  const data = source === 'meta'
    ? { ...(await fetchMetaJson(url)), decompress: true }
    : { decompress: true };

  const asset = new Asset(filename, 'gsplat', {
    url,
    filename,
  }, data);

  return await new Promise<Float32Array>((resolve, reject) => {
    asset.once('load', () => {
      try {
        const centers = readCentersFromResource(asset.resource) ?? readCentersFromResource(asset);
        if (!centers || centers.length === 0) {
          reject(new Error(`Loaded GSplat asset did not expose point centers for ${url}`));
          return;
        }
        resolve(sanitizeCenters(centers, url));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        app.assets.remove(asset);
        asset.unload();
      }
    });

    asset.once('error', (error: unknown) => {
      app.assets.remove(asset);
      asset.unload();
      reject(error instanceof Error ? error : new Error(`Failed to load GSplat asset: ${url}`));
    });

    app.assets.add(asset);
    app.assets.load(asset);
  });
}

async function extractLodCenters(app: GsplatLoaderApp, asset: ResolvedViewerAsset): Promise<Float32Array> {
  const chunkUrls = await fetchLodChunkUrls(asset.url);
  if (chunkUrls.length === 0) {
    throw new Error(`LOD manifest did not reference any GSplat chunks for ${asset.url}`);
  }

  const centerArrays: Float32Array[] = [];
  for (const chunkUrl of chunkUrls) {
    centerArrays.push(await loadSingleGsplatCenters(app, chunkUrl, 'scene'));
  }
  return concatCenterArrays(centerArrays);
}

export async function extractGsplatPointCentersFromResolvedAsset(asset: ResolvedViewerAsset): Promise<Float32Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  const device = await createGraphicsDevice(canvas, {
    deviceTypes: ['webgl2'],
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });

  const app = new GsplatLoaderApp(canvas, device);

  try {
    if (!asset.url) {
      throw new Error('Resolved GSplat asset did not include a URL');
    }

    if (asset.source === 'lod') {
      return await extractLodCenters(app, asset);
    }

    return await loadSingleGsplatCenters(app, asset.url, asset.source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract point centers from ${asset.format} asset at ${asset.url}: ${message}`);
  } finally {
    app.destroy();
  }
}

export async function extractGsplatPointCenters(manifest: ViewerManifest): Promise<Float32Array> {
  return extractGsplatPointCentersFromResolvedAsset(resolveViewerAsset(manifest));
}

export { fetchLodChunkUrls };
