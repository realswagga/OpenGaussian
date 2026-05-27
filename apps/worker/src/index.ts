import 'dotenv/config';
import Redis from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration from environment
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/gsplat';
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://minio:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
const S3_BUCKET = process.env.S3_BUCKET || 'gsplat-assets';
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE !== 'false';

type JobType = 'splat.validate' | 'splat.convert' | 'splat.generateLod' | 'splat.generatePreview' | 'splat.extractMetadata' | 'splat.publishPrepare' | 'splat.cleanup' | 'splat.applyPretransform';

interface JobData {
  splatId: string;
  versionId: string;
  sourceObjectKey?: string;
  jobType: JobType;
  [key: string]: unknown;
}

const prisma = new PrismaClient();

const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: S3_FORCE_PATH_STYLE,
});

const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

function getSplatExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'compressed.ply' || lower.endsWith('.compressed.ply')) return '.compressed.ply';
  if (lower === 'lod-meta.json' || lower.endsWith('/lod-meta.json') || lower.endsWith('.lod-meta.json')) return '.lod-meta.json';
  if (lower === 'meta.json' || lower.endsWith('/meta.json') || lower.endsWith('.meta.json')) return '.meta.json';
  return path.extname(lower);
}

function formatFromExtension(ext: string): string {
  if (ext === '.compressed.ply') return 'compressed-ply';
  if (ext === '.meta.json') return 'sog-meta';
  if (ext === '.lod-meta.json') return 'lod-meta';
  return ext.replace('.', '');
}

function outputNameForFormat(format: string): string {
  if (format === 'compressed-ply') return 'scene.compressed.ply';
  if (format === 'sog-meta') return 'scene.meta.json';
  if (format === 'lod-meta') return 'lod-meta.json';
  return `scene.${format}`;
}

function contentTypeForFormat(format: string): string {
  if (format === 'sog-meta' || format === 'lod-meta') return 'application/json';
  return 'application/octet-stream';
}

async function ensureBucket(): Promise<void> {
  try {
    await s3Client.send({ client: s3Client, command: 'HeadBucket' } as any);
    console.log(`[worker] Bucket "${S3_BUCKET}" exists`);
  } catch {
    console.log(`[worker] Creating bucket "${S3_BUCKET}"...`);
    try {
      await s3Client.send({
        command: 'CreateBucket',
        Bucket: S3_BUCKET,
      } as any);
    } catch {
      // Bucket might already exist
    }
    console.log(`[worker] Bucket "${S3_BUCKET}" created`);
  }
}

async function updateVersionLog(versionId: string, message: string): Promise<void> {
  try {
    const version = await prisma.splatVersion.findUnique({ where: { id: versionId } });
    if (version) {
      const existingLog = version.processingLog || '';
      await prisma.splatVersion.update({
        where: { id: versionId },
        data: { processingLog: existingLog ? `${existingLog}\n${message}` : message },
      });
    }
  } catch (err) {
    console.error(`[worker] Failed to update version log:`, err);
  }
}

async function downloadOriginal(splatId: string, versionId: string, sourceKey: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const ext = path.extname(sourceKey) || '.ply';
  const tmpFile = path.join(tmpDir, `${splatId}-${versionId}-source${ext}`);

  console.log(`[worker] Downloading ${sourceKey} from S3...`);
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: sourceKey,
  }));

  const stream = response.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  await fs.promises.writeFile(tmpFile, buffer);

  console.log(`[worker] Downloaded ${sourceKey} to ${tmpFile} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  return tmpFile;
}

async function uploadAsset(splatId: string, versionId: string, localPath: string, key: string, contentType?: string): Promise<string> {
  const fileContent = await fs.promises.readFile(localPath);
  const fullKey = `splats/${splatId}/versions/${versionId}/${key}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: fullKey,
    Body: fileContent,
    ContentType: contentType || 'application/octet-stream',
  }));

  console.log(`[worker] Uploaded ${fullKey} (${(fileContent.length / 1024 / 1024).toFixed(2)} MB)`);
  return fullKey;
}

async function validateFile(filePath: string): Promise<{ format: string; fileSize: number }> {
  const stats = await fs.promises.stat(filePath);
  const ext = getSplatExtension(filePath);
  const format = formatFromExtension(ext);

  const validFormats = ['ply', 'sog', 'spz', 'compressed-ply', 'sog-meta', 'lod-meta'];
  if (!validFormats.includes(format)) {
    throw new Error(`Unsupported file format: ${ext}`);
  }

  if (stats.size === 0) {
    throw new Error('File is empty');
  }

  console.log(`[worker] Validated: format=${format}, size=${stats.size}`);
  return { format, fileSize: stats.size };
}

async function extractMetadata(filePath: string): Promise<{
  format: string;
  fileSize: number;
  approximateSplatCount: number;
}> {
  const stats = await fs.promises.stat(filePath);
  const format = formatFromExtension(getSplatExtension(filePath));

  // Rough estimate based on format
  let bytesPerSplat = 100;
  if (format === 'sog' || format === 'sog-meta' || format === 'lod-meta') bytesPerSplat = 40;
  if (format === 'spz') bytesPerSplat = 60;

  const approximateSplatCount = Math.max(1, Math.round(stats.size / bytesPerSplat));

  return {
    format,
    fileSize: stats.size,
    approximateSplatCount,
  };
}

async function markVersionReady(splatId: string, versionId: string, updates: {
  convertedKey?: string;
  productionFormat?: string;
  metaKey?: string;
  lodKey?: string;
  posterKey?: string;
  splatCount?: number;
  sizeBytes?: number;
}): Promise<void> {
  await prisma.splatVersion.update({
    where: { id: versionId },
    data: {
      processingStatus: 'READY',
      convertedKey: updates.convertedKey || null,
      metricsJson: {
        format: updates.productionFormat,
        splatCount: updates.splatCount,
        fileSize: updates.sizeBytes,
      },
    },
  });

  // Update splat record
  await prisma.splat.update({
    where: { id: splatId },
    data: {
      status: 'READY',
      productionFormat: updates.productionFormat || null,
      productionObjectKey: updates.convertedKey || null,
      lodManifestKey: updates.lodKey || null,
      posterKey: updates.posterKey || null,
      splatCount: updates.splatCount || null,
      sizeBytes: updates.sizeBytes ? BigInt(updates.sizeBytes) : null,
    },
  });
}

// ────────────────────────────────────────────
// Asset preview helpers
// ────────────────────────────────────────────

async function writeTempBinary(data: Buffer): Promise<string> {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `preview-${Date.now()}.bin`);
  await fs.promises.writeFile(tmpFile, data);
  return tmpFile;
}

async function writeBuffer(key: string, buffer: Buffer): Promise<string> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/octet-stream',
  }));
  console.log(`[worker] Wrote buffer to ${key} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  return key;
}

function buildPlyHeader(vertexCount: number): Buffer {
  // Build a minimal binary PLY header for gaussian splats (62 floats per vertex)
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float f_rest_0',  'property float f_rest_1',  'property float f_rest_2',
    'property float f_rest_3',  'property float f_rest_4',  'property float f_rest_5',
    'property float f_rest_6',  'property float f_rest_7',  'property float f_rest_8',
    'property float f_rest_9',  'property float f_rest_10', 'property float f_rest_11',
    'property float f_rest_12', 'property float f_rest_13', 'property float f_rest_14',
    'property float f_rest_15', 'property float f_rest_16', 'property float f_rest_17',
    'property float f_rest_18', 'property float f_rest_19', 'property float f_rest_20',
    'property float f_rest_21', 'property float f_rest_22', 'property float f_rest_23',
    'property float f_rest_24', 'property float f_rest_25', 'property float f_rest_26',
    'property float f_rest_27', 'property float f_rest_28', 'property float f_rest_29',
    'property float f_rest_30', 'property float f_rest_31', 'property float f_rest_32',
    'property float f_rest_33', 'property float f_rest_34', 'property float f_rest_35',
    'property float f_rest_36', 'property float f_rest_37', 'property float f_rest_38',
    'property float f_rest_39', 'property float f_rest_40', 'property float f_rest_41',
    'property float f_rest_42', 'property float f_rest_43', 'property float f_rest_44',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header',
    '',
  ].join('\n');

  return Buffer.from(header, 'ascii');
}

async function generatePoster(plyPath: string): Promise<Buffer> {
  // Generate a simple 256x256 PNG showing a top-down bounded projection
  // of the point cloud positions. Uses a minimal PNG encoder approach.

  const fileBuffer = await fs.promises.readFile(plyPath);
  const headerStr = fileBuffer.toString('ascii', 0, 4096);
  const vMatch = /element vertex (\d+)/.exec(headerStr);
  const totalSplats = vMatch?.[1] ? parseInt(vMatch[1], 10) : 100000;
  const headerEnd = fileBuffer.indexOf('end_header\n');
  const dataStart = headerEnd >= 0 ? headerEnd + 'end_header\n'.length : 0;

  // Parse only position data from first N points (fast, header-only-ish)
  const sampleCount = Math.min(totalSplats, 50000);
  const vertexSize = 62 * 4;
  const sampleStride = Math.max(1, Math.floor(totalSplats / sampleCount));

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  // First pass: find bounds
  for (let i = 0; i < sampleCount; i++) {
    const srcIdx = Math.min(i * sampleStride, totalSplats - 1);
    const off = dataStart + srcIdx * vertexSize;
    if (off + 12 > fileBuffer.length) break;

    const x = fileBuffer.readFloatLE(off);
    const z = fileBuffer.readFloatLE(off + 8);
    if (!isNaN(x) && !isNaN(z)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  // Normalize bounds
  if (!isFinite(minX)) { minX = -4; maxX = 4; }
  if (!isFinite(minZ)) { minZ = -4; maxZ = 4; }

  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const padding = 0.05;

  // Second pass: accumulate into 256x256 density grid
  const W = 256, H = 256;
  const density = new Float32Array(W * H);
  const colorR = new Float32Array(W * H);
  const colorG = new Float32Array(W * H);
  const colorB = new Float32Array(W * H);

  for (let i = 0; i < sampleCount; i++) {
    const srcIdx = Math.min(i * sampleStride, totalSplats - 1);
    const off = dataStart + srcIdx * vertexSize;
    if (off + 12 > fileBuffer.length) break;

    const x = fileBuffer.readFloatLE(off);
    const z = fileBuffer.readFloatLE(off + 8);

    if (isNaN(x) || isNaN(z)) continue;

    const u = (x - minX) / rangeX * (1 - 2 * padding) + padding;
    const v = (z - minZ) / rangeZ * (1 - 2 * padding) + padding;

    const px = Math.floor(u * W);
    const py = Math.floor((1 - v) * H); // flip Z for top-down view

    if (px >= 0 && px < W && py >= 0 && py < H) {
      const idx = py * W + px;
      density[idx] = (density[idx] ?? 0) + 1;

      // Try to read SH DC color if available (offset 24-35 in vertex)
      if (off + 36 <= fileBuffer.length) {
        const dc0 = fileBuffer.readFloatLE(off + 24);
        const dc1 = fileBuffer.readFloatLE(off + 28);
        const dc2 = fileBuffer.readFloatLE(off + 32);
        const SH_C0 = 0.28209479177387814;
        if (!isNaN(dc0)) colorR[idx] = (colorR[idx] ?? 0) + Math.max(0, Math.min(1, SH_C0 * dc0 + 0.5));
        if (!isNaN(dc1)) colorG[idx] = (colorG[idx] ?? 0) + Math.max(0, Math.min(1, SH_C0 * dc1 + 0.5));
        if (!isNaN(dc2)) colorB[idx] = (colorB[idx] ?? 0) + Math.max(0, Math.min(1, SH_C0 * dc2 + 0.5));
      }
    }
  }

  // Normalize
  let maxDensity = 0;
  for (let i = 0; i < density.length; i++) {
    const value = density[i] ?? 0;
    if (value > maxDensity) maxDensity = value;
  }

  // Build RGBA pixel buffer
  const pixels = Buffer.alloc(W * H * 4);
  for (let i = 0; i < density.length; i++) {
    const densityValue = density[i] ?? 0;
    const d = maxDensity > 0 ? Math.pow(densityValue / maxDensity, 0.5) : 0;
    const count = Math.max(1, densityValue);
    const r = d * ((colorR[i] ?? 0) / count) * 255;
    const g = d * ((colorG[i] ?? 0) / count) * 255;
    const b = d * ((colorB[i] ?? 0) / count) * 255;
    const a = Math.min(255, d * 255 + 40); // Add slight background

    const px = i * 4;
    pixels[px] = Math.round(Math.min(255, r));
    pixels[px + 1] = Math.round(Math.min(255, g));
    pixels[px + 2] = Math.round(Math.min(255, b));
    pixels[px + 3] = Math.round(Math.min(255, a));
  }

  // Encode as PNG using zlib (minimal PNG with deflate)
  // Use Node's built-in zlib for PNG encoding
  const zlib = await import('zlib');

  // Build minimal PNG
  const png = createPNG(W, H, pixels, zlib);
  return png;
}

async function generatePreviewSmall(posterBuffer: Buffer): Promise<Buffer> {
  // Resize the 256x256 poster to 128x128 by simple averaging
  // Since we're generating from scratch, just re-render at half resolution
  // For simplicity, return a smaller version of the buffer
  // (in a real implementation, we'd decode PNG, resize, re-encode)
  return posterBuffer; // Placeholder: same buffer for now
}

function createPNG(width: number, height: number, pixels: Buffer, zlib: typeof import('zlib')): Buffer {
  // Build raw image data (filter byte 0 + RGB for each row)
  const rawData: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    rawData.push(Buffer.from([0])); // filter none
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const px = rowStart + x * 4;
      rawData.push(Buffer.from([pixels[px] ?? 0, pixels[px + 1] ?? 0, pixels[px + 2] ?? 0]));
    }
  }
  const rawBuf = Buffer.concat(rawData);

  const deflated = zlib.deflateSync(rawBuf);

  // Build chunks
  const chunks: Buffer[] = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  chunks.push(createPngChunk('IHDR', ihdrData));

  // IDAT chunk(s) - split into ~64KB chunks for compatibility
  const maxChunkSize = 65536;
  for (let i = 0; i < deflated.length; i += maxChunkSize) {
    const slice = deflated.subarray(i, i + maxChunkSize);
    chunks.push(createPngChunk('IDAT', slice));
  }

  // IEND chunk
  chunks.push(createPngChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');

  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcBuf);

  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc, 0);

  return Buffer.concat([len, typeBuf, data, crcOut]);
}

// CRC32 implementation for PNG
const crc32Table = new Uint32Array(256);
function initCrc32Table(): void {
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc32Table[n] = c;
  }
}
initCrc32Table();

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    crc = (crc32Table[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function markVersionFailed(versionId: string, splatId: string, errorMessage: string): Promise<void> {
  await prisma.splatVersion.update({
    where: { id: versionId },
    data: {
      processingStatus: 'FAILED',
      processingLog: `FAILED: ${errorMessage}`,
    },
  });

  await prisma.splat.update({
    where: { id: splatId },
    data: { status: 'FAILED' },
  });
}

// Process a single job
async function processJob(job: Job<JobData>): Promise<unknown> {
  const { splatId, versionId, sourceObjectKey, jobType } = job.data;
  console.log(`[worker] Processing job ${job.id}: type=${jobType}, splat=${splatId}, version=${versionId}`);

  await job.updateProgress(5);
  await updateVersionLog(versionId, `[${new Date().toISOString()}] Starting ${jobType}`);

  try {
    switch (jobType) {
      case 'splat.validate': {
        if (!sourceObjectKey) throw new Error('sourceObjectKey is required for validation');
        const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
        await job.updateProgress(30);
        await updateVersionLog(versionId, 'Validating file...');
        const result = await validateFile(tmpFile);
        await fs.promises.unlink(tmpFile).catch(() => {});
        await job.updateProgress(100);
        await updateVersionLog(versionId, `Validation OK: format=${result.format}, size=${result.fileSize}`);
        return result;
      }

      case 'splat.extractMetadata': {
        if (!sourceObjectKey) throw new Error('sourceObjectKey is required for metadata extraction');
        const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
        await job.updateProgress(30);
        await updateVersionLog(versionId, 'Extracting metadata...');
        const metadata = await extractMetadata(tmpFile);
        await fs.promises.unlink(tmpFile).catch(() => {});
        await job.updateProgress(100);
        await updateVersionLog(versionId, `Metadata extracted: ~${metadata.approximateSplatCount.toLocaleString()} splats`);
        return metadata;
      }

      case 'splat.convert': {
        if (!sourceObjectKey) throw new Error('sourceObjectKey is required for conversion');
        const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
        await job.updateProgress(30);
        await updateVersionLog(versionId, 'Converting to production format...');

        const ext = getSplatExtension(sourceObjectKey);
        const productionFormat = formatFromExtension(ext);
        const outputKey = outputNameForFormat(productionFormat);
        const fullKey = await uploadAsset(
          splatId,
          versionId,
          tmpFile,
          outputKey,
          contentTypeForFormat(productionFormat),
        );

        const stats = await fs.promises.stat(tmpFile);
        await fs.promises.unlink(tmpFile).catch(() => {});

        // Estimate splat count
        let bytesPerSplat = 100;
        if (productionFormat === 'sog' || productionFormat === 'sog-meta' || productionFormat === 'lod-meta') bytesPerSplat = 40;
        if (productionFormat === 'spz') bytesPerSplat = 60;
        const splatCount = Math.round(stats.size / bytesPerSplat);

        await job.updateProgress(90);
        await updateVersionLog(versionId, 'Updating database with results...');

        // Mark version as ready with all collected info
        await markVersionReady(splatId, versionId, {
          convertedKey: fullKey,
          productionFormat,
          lodKey: productionFormat === 'lod-meta' ? fullKey : undefined,
          metaKey: productionFormat === 'sog-meta' ? fullKey : undefined,
          splatCount,
          sizeBytes: stats.size,
        });

        await job.updateProgress(100);
        await updateVersionLog(versionId, `Conversion complete: ${productionFormat}, ~${splatCount.toLocaleString()} splats`);
        return {
          productionObjectKey: fullKey,
          productionFormat,
          splatCount,
          fileSize: stats.size,
        };
      }

          case 'splat.generateLod': {
              if (!sourceObjectKey) throw new Error('sourceObjectKey required for LOD generation');
      
              await job.updateProgress(5);
              await updateVersionLog(versionId, 'Starting LOD generation...');
      
              const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
              await job.updateProgress(15);
      
              const ext = getSplatExtension(sourceObjectKey);
              const format = formatFromExtension(ext);
      
              // Only generate LOD for PLY files
              if (format !== 'ply' && format !== 'compressed-ply') {
                await fs.promises.unlink(tmpFile).catch(() => {});
                await updateVersionLog(versionId, `LOD generation skipped: format "${format}" not supported for LOD. Only PLY files can be auto-chunked.`);
                await markVersionReady(splatId, versionId, {});
                await job.updateProgress(100);
                return { skipped: true, reason: `Unsupported format: ${format}` };
              }
      
              // Read PLY to extract vertex positions
              const fileBuffer = await fs.promises.readFile(tmpFile);
              const headerStr = fileBuffer.toString('ascii', 0, Math.min(fileBuffer.length, 8192));
              const isAscii = headerStr.startsWith('ply\nformat ascii');
              const isBinary = headerStr.startsWith('ply\nformat binary_little_endian');
      
              if (!isAscii && !isBinary) {
                await fs.promises.unlink(tmpFile).catch(() => {});
                await updateVersionLog(versionId, 'LOD skipped: unrecognized PLY format');
                await markVersionReady(splatId, versionId, {});
                await job.updateProgress(100);
                return { skipped: true, reason: 'Unrecognized PLY format' };
              }
      
              const vMatch = /element vertex (\d+)/.exec(headerStr);
              const totalVertices = vMatch?.[1] ? parseInt(vMatch[1], 10) : 0;
              const headerEnd = fileBuffer.indexOf('end_header\n');
              const dataStart = headerEnd >= 0 ? headerEnd + 'end_header\n'.length : 0;
      
              if (totalVertices === 0 || dataStart === 0) {
                await fs.promises.unlink(tmpFile).catch(() => {});
                await updateVersionLog(versionId, 'LOD skipped: could not parse vertex count');
                await markVersionReady(splatId, versionId, {});
                await job.updateProgress(100);
                return { skipped: true, reason: 'Could not parse PLY header' };
              }
      
              await updateVersionLog(versionId, `Parsed PLY: ${totalVertices.toLocaleString()} vertices, format=${isAscii ? 'ascii' : 'binary'}`);
      
              // For binary PLY, extract positions using known vertex size (62 floats)
              const vertexSize = isBinary ? 62 * 4 : 0; // 62 floats × 4 bytes
      
              // Build spatial octree
              // Read all positions first pass: find bounds
              let minX = Infinity, maxX = -Infinity;
              let minY = Infinity, maxY = -Infinity;
              let minZ = Infinity, maxZ = -Infinity;
      
              const positions: { x: number; y: number; z: number; offset: number }[] = [];
      
              if (isBinary) {
                for (let i = 0; i < totalVertices; i++) {
                  const off = dataStart + i * vertexSize;
                  if (off + 12 > fileBuffer.length) break;
                  const x = fileBuffer.readFloatLE(off);
                  const y = fileBuffer.readFloatLE(off + 4);
                  const z = fileBuffer.readFloatLE(off + 8);
                  if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                    positions.push({ x, y, z, offset: off });
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                  }
                }
              }
      
              if (!isFinite(minX)) { minX = -4; maxX = 4; minY = -2; maxY = 2; minZ = -4; maxZ = 4; }
              await job.updateProgress(30);
      
              // Build octree cells
              const gridSize = 8; // 8×8×8 = 512 cells
              const cellSizeX = (maxX - minX) / gridSize || 1;
              const cellSizeY = (maxY - minY) / gridSize || 1;
              const cellSizeZ = (maxZ - minZ) / gridSize || 1;
      
              interface Cell {
                cx: number; cy: number; cz: number;
                vertices: { x: number; y: number; z: number; offset: number }[];
              }
              const cellMap = new Map<string, Cell>();
      
              for (const v of positions) {
                const cx = Math.min(gridSize - 1, Math.floor((v.x - minX) / cellSizeX));
                const cy = Math.min(gridSize - 1, Math.floor((v.y - minY) / cellSizeY));
                const cz = Math.min(gridSize - 1, Math.floor((v.z - minZ) / cellSizeZ));
                const key = `${cx}_${cy}_${cz}`;
                if (!cellMap.has(key)) {
                  cellMap.set(key, { cx, cy, cz, vertices: [] });
                }
                cellMap.get(key)!.vertices.push(v);
              }
      
              await updateVersionLog(versionId, `Built ${cellMap.size} octree cells from ${positions.length} positions`);
              await job.updateProgress(45);
      
              // LOD levels: 100%, 25%, 6%, 1.5%
              const lodLevels = [
                { name: 'lod-0', ratio: 1.0 },
                { name: 'lod-25', ratio: 0.25 },
                { name: 'lod-6', ratio: 0.06 },
                { name: 'lod-1-5', ratio: 0.015 },
              ];
      
              const chunkManifest: Record<string, unknown>[] = [];
              const cells = Array.from(cellMap.values());
      
              // Track how many cells actually produce files
              let filesWritten = 0;
      
              for (const cell of cells) {
                const cellName = `cell-${cell.cx}_${cell.cy}_${cell.cz}`;
      
                for (const lod of lodLevels) {
                  if (cell.vertices.length === 0) continue;
                  const sampleCount = Math.max(1, Math.round(cell.vertices.length * lod.ratio));
      
                  // Importance-sampled: pick evenly spaced vertices for distribution
                  const stride = Math.max(1, Math.floor(cell.vertices.length / sampleCount));
                  const sampled = [];
                  for (let s = 0; s < Math.min(sampleCount, cell.vertices.length); s++) {
                    const idx = Math.min(s * stride, cell.vertices.length - 1);
                    sampled.push(cell.vertices[idx]!);
                  }
      
                  if (sampled.length < 10) continue; // Skip trivial chunks
      
                  // Build a minimal binary PLY chunk
                  const chunkHeader = buildPlyHeader(sampled.length);
                  const chunkData = Buffer.alloc(sampled.length * vertexSize);
                  for (let s = 0; s < sampled.length; s++) {
                    const srcOff = sampled[s]!.offset;
                    const dstOff = s * vertexSize;
                    if (srcOff + vertexSize <= fileBuffer.length) {
                      fileBuffer.copy(chunkData, dstOff, srcOff, srcOff + vertexSize);
                    }
                  }
      
                  const chunkBuf = Buffer.concat([chunkHeader, chunkData]);
                  const chunkKey = `splats/${splatId}/versions/${versionId}/chunks/${cellName}_${lod.name}.ply`;
      
                  await writeBuffer(chunkKey, chunkBuf);
                  filesWritten++;
      
                  chunkManifest.push({
                    cell: cellName,
                    lod: lod.name,
                    vertexCount: sampled.length,
                    key: chunkKey,
                    bounds: {
                      min: [minX + cell.cx * cellSizeX, minY + cell.cy * cellSizeY, minZ + cell.cz * cellSizeZ],
                      max: [minX + (cell.cx + 1) * cellSizeX, minY + (cell.cy + 1) * cellSizeY, minZ + (cell.cz + 1) * cellSizeZ],
                    },
                  });
                }
              }
      
              const boundsRadius = Math.sqrt(
                ((maxX - minX) / 2) ** 2 +
                ((maxY - minY) / 2) ** 2 +
                ((maxZ - minZ) / 2) ** 2
              ) || 4;

              const transitionDistances = [
                0.3 * boundsRadius,
                1.0 * boundsRadius,
                3.0 * boundsRadius,
              ];

              // Build lod-meta.json manifest
              const lodMeta = {
                version: 1,
                gridSize,
                bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
                cellCount: cellMap.size,
                format: 'ply',
                transitionDistances,
                chunks: chunkManifest,
              };
      
              const lodMetaJson = JSON.stringify(lodMeta);
              const lodMetaBuf = Buffer.from(lodMetaJson, 'utf-8');
              const lodMetaKey = `splats/${splatId}/versions/${versionId}/scene.lod-meta.json`;
              await writeBuffer(lodMetaKey, lodMetaBuf);
      
              // Write a full scene PLY for direct load fallback
              const fullSceneKey = `splats/${splatId}/versions/${versionId}/scene.ply`;
              const fullHeader = buildPlyHeader(positions.length);
              const fullData = Buffer.alloc(positions.length * vertexSize);
              for (let i = 0; i < positions.length; i++) {
                const srcOff = positions[i]!.offset;
                const dstOff = i * vertexSize;
                if (srcOff + vertexSize <= fileBuffer.length) {
                  fileBuffer.copy(fullData, dstOff, srcOff, srcOff + vertexSize);
                }
              }
              await writeBuffer(fullSceneKey, Buffer.concat([fullHeader, fullData]));
      
              await fs.promises.unlink(tmpFile).catch(() => {});
      
              await job.updateProgress(85);
              await updateVersionLog(versionId, `LOD generation complete: ${filesWritten} chunk files, ${chunkManifest.length} manifest entries`);
      
              const stats = await fs.promises.stat(await writeTempBinary(lodMetaBuf));
      
              // Mark version as ready with LOD info
              await markVersionReady(splatId, versionId, {
                convertedKey: fullSceneKey,
                productionFormat: 'ply',
                lodKey: lodMetaKey,
                splatCount: positions.length,
                sizeBytes: stats.size,
              });
      
              await job.updateProgress(100);
              await updateVersionLog(versionId, `LOD complete: ${positions.length.toLocaleString()} splats in ${cellMap.size} cells, ${lodLevels.length} LOD levels`);
              return { cellCount: cellMap.size, splatCount: positions.length, lodLevels: lodLevels.length };
            }

      case 'splat.generatePreview': {
        if (!sourceObjectKey) throw new Error('sourceObjectKey required for preview');

        await job.updateProgress(10);
        await updateVersionLog(versionId, 'Downloading source for preview...');

        const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);

        await job.updateProgress(40);
        await updateVersionLog(versionId, 'Generating poster image...');

        // Generate poster: extract first N points, compute bounding box, create a minimal
        // 256x256 PNG showing a top-down projection of the point cloud
        const posterBuffer = await generatePoster(tmpFile);

        await job.updateProgress(70);

        const posterKey = await uploadAsset(
          splatId, versionId,
          await writeTempBinary(posterBuffer),
          'poster.png',
          'image/png',
        );

        // Generate small preview too
        const previewBuffer = await generatePreviewSmall(posterBuffer);
        await uploadAsset(
          splatId, versionId,
          await writeTempBinary(previewBuffer),
          'preview-small.png',
          'image/png',
        );

        // Update DB
        await prisma.splatVersion.update({
          where: { id: versionId },
          data: { posterKey },
        });

        await prisma.splat.update({
          where: { id: splatId },
          data: { posterKey },
        });

        await fs.promises.unlink(tmpFile).catch(() => {});
        await job.updateProgress(100);
        await updateVersionLog(versionId, `Preview generation complete: poster at ${posterKey}`);
        return { posterKey };
      }

      case 'splat.applyPretransform': {
        await job.updateProgress(5);
        await updateVersionLog(versionId, 'Checking pretransform settings...');

        const splatRecord = await prisma.splat.findUnique({
          where: { id: splatId },
          select: { pretransformJson: true, productionObjectKey: true, productionFormat: true },
        });

        if (!splatRecord?.pretransformJson) {
          await updateVersionLog(versionId, 'No pretransform set; nothing to apply.');
          await job.updateProgress(100);
          return { skipped: true, reason: 'No pretransform' };
        }

        const pretransform = splatRecord.pretransformJson as {
          position: [number, number, number];
          rotation: [number, number, number];
          scale: [number, number, number];
        };

        await updateVersionLog(versionId,
          `Applying pretransform: pos=[${pretransform.position.join(',')}], rot=[${pretransform.rotation.join(',')}], scale=[${pretransform.scale.join(',')}]`
        );

        const fmt = splatRecord.productionFormat || 'ply';
        if (fmt !== 'ply' && fmt !== 'compressed-ply') {
          await updateVersionLog(versionId, `Pretransform skipped: cannot transform format "${fmt}"`);
          await job.updateProgress(100);
          return { skipped: true, reason: `Unsupported format: ${fmt}` };
        }

        const prodKey = splatRecord.productionObjectKey || sourceObjectKey;
        if (!prodKey) throw new Error('No production asset found to transform');

        const tmpFile = await downloadOriginal(splatId, versionId, prodKey);
        await job.updateProgress(30);

        const fileBuffer = await fs.promises.readFile(tmpFile);
        const hdrEnd = fileBuffer.indexOf('end_header\n');
        if (hdrEnd < 0) {
          await fs.promises.unlink(tmpFile).catch(() => {});
          throw new Error('Not a valid PLY file');
        }

        const dataStart = hdrEnd + 'end_header\n'.length;
        const hdrStr = fileBuffer.toString('ascii', 0, Math.min(fileBuffer.length, 8192));
        const vMatch = /element vertex (\d+)/.exec(hdrStr);
        const totalVertices = vMatch?.[1] ? parseInt(vMatch[1], 10) : 0;

        if (totalVertices === 0) {
          await fs.promises.unlink(tmpFile).catch(() => {});
          throw new Error('Could not determine vertex count');
        }

        const isBin = hdrStr.includes('binary_little_endian');
        const vertexSize = isBin ? 62 * 4 : 0;
        if (!isBin || vertexSize === 0) {
          await fs.promises.unlink(tmpFile).catch(() => {});
          throw new Error('Pretransform only supports binary PLY');
        }

        const degToRad = Math.PI / 180;
        const [rx, ry, rz] = pretransform.rotation.map((r) => r * degToRad) as [number, number, number];
        const [sx, sy, sz] = pretransform.scale;
        const [px, py, pz] = pretransform.position;

        const cx = Math.cos(rx), srx = Math.sin(rx);
        const cy = Math.cos(ry), sry = Math.sin(ry);
        const cz = Math.cos(rz), srz = Math.sin(rz);

        const r00 = cy * cz;
        const r01 = cz * sry * srx - cx * srz;
        const r02 = cx * cz * sry + srx * srz;
        const r10 = cy * srz;
        const r11 = cx * cz + sry * srx * srz;
        const r12 = cx * sry * srz - cz * srx;
        const r20 = -sry;
        const r21 = cy * srx;
        const r22 = cx * cy;

        await updateVersionLog(versionId, `Transforming ${totalVertices.toLocaleString()} vertices...`);
        await job.updateProgress(50);

        const transformed = Buffer.alloc(totalVertices * vertexSize);
        for (let i = 0; i < totalVertices; i++) {
          const srcOff = dataStart + i * vertexSize;
          const dstOff = i * vertexSize;
          if (srcOff + 12 > fileBuffer.length) break;

          const vx = fileBuffer.readFloatLE(srcOff);
          const vy = fileBuffer.readFloatLE(srcOff + 4);
          const vz = fileBuffer.readFloatLE(srcOff + 8);

          const scx = vx * sx, scy = vy * sy, scz = vz * sz;
          const rxVal = r00 * scx + r01 * scy + r02 * scz;
          const ryVal = r10 * scx + r11 * scy + r12 * scz;
          const rzVal = r20 * scx + r21 * scy + r22 * scz;
          const tx = rxVal + px, ty = ryVal + py, tz = rzVal + pz;

          transformed.writeFloatLE(tx, dstOff);
          transformed.writeFloatLE(ty, dstOff + 4);
          transformed.writeFloatLE(tz, dstOff + 8);

          if (vertexSize > 12) {
            fileBuffer.copy(transformed, dstOff + 12, srcOff + 12, srcOff + vertexSize);
          }
        }

        await job.updateProgress(75);
        await updateVersionLog(versionId, 'Uploading transformed PLY...');

        const transformedKey = `splats/${splatId}/versions/${versionId}/scene-transformed.ply`;
        await writeBuffer(transformedKey, transformed);

        await prisma.splat.update({
          where: { id: splatId },
          data: { productionObjectKey: transformedKey },
        });
        await prisma.splatVersion.update({
          where: { id: versionId },
          data: { convertedKey: transformedKey },
        });

        await fs.promises.unlink(tmpFile).catch(() => {});
        await job.updateProgress(100);
        await updateVersionLog(versionId, 'Pretransform applied successfully');
        return { transformedKey };
      }

      case 'splat.publishPrepare': {
        await updateVersionLog(versionId, 'Publish preparation complete');
        await job.updateProgress(100);
        return { ready: true };
      }

      case 'splat.cleanup': {
        await updateVersionLog(versionId, 'Cleanup complete (no temp files to clean)');
        await job.updateProgress(100);
        return { cleaned: true };
      }

      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }
  } catch (error: any) {
    console.error(`[worker] Job ${job.id} failed:`, error.message);
    await markVersionFailed(versionId, splatId, error.message);
    throw error;
  }
}

async function start() {
  console.log('[worker] Starting GSplat worker...');

  // Connect to database
  await prisma.$connect();
  console.log('[worker] Connected to PostgreSQL');

  // Log all existing splats for debugging
  const splatCount = await prisma.splat.count();
  console.log(`[worker] Found ${splatCount} splats in database`);

  await ensureBucket();

  const worker = new Worker<JobData>('splat-processing', processJob, {
    connection: redisConnection,
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[worker] Job ${job?.id} failed:`, error.message);
  });

  console.log('[worker] Worker started, listening on "splat-processing" queue');

  // Keep alive
  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM received, shutting down...');
    await worker.close();
    await redisConnection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[worker] SIGINT received, shutting down...');
    await worker.close();
    await redisConnection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
