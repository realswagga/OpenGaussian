import 'dotenv/config';
import Redis from 'ioredis';
import { Worker, Job } from 'bullmq';
import { Prisma, PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { AssetVariantName } from '@gsplat/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { createPlayCanvasLodManifest, sampleLodVertices, type LodCellManifestInput, type LodSourceVertex } from './lodManifest.js';
import {
  SPLAT_VARIANT_CONFIGS,
  computeVariantTargets,
  type WorkerAssetVariantMetadata,
} from './assetVariants.js';
import { readHeaderSplatCount, readManifestSplatCount } from './assetMetadata.js';

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

type AssetVariantMap = Partial<Record<AssetVariantName, WorkerAssetVariantMetadata>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
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

function markerSnapshot(a: {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  icon: string | null;
  color: string | null;
}) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    kind: a.kind,
    position: [a.positionX, a.positionY, a.positionZ],
    rotation: [a.rotationX, a.rotationY, a.rotationZ],
    scale: a.scale,
    icon: a.icon,
    color: a.color,
  };
}

async function syncVersionSettingsSnapshot(splatId: string, versionId: string): Promise<void> {
  const version = await prisma.splatVersion.findFirst({
    where: { id: versionId, splatId },
    include: { annotations: { orderBy: { createdAt: 'asc' } } },
  });
  if (!version) return;

  const settingsKey = `splats/${splatId}/versions/${versionId}/settings.json`;
  const snapshot = {
    schemaVersion: 1,
    splatId,
    versionId,
    version: version.version,
    productionFormat: version.productionFormat,
    convertedKey: version.convertedKey,
    lodKey: version.lodKey,
    posterKey: version.posterKey,
    splatCount: version.splatCount,
    sizeBytes: version.sizeBytes ? Number(version.sizeBytes) : null,
    boundingBox: version.boundingBoxJson,
    defaultCamera: version.defaultCameraJson,
    globalSettings: version.globalSettingsJson,
    pretransform: version.pretransformJson,
    markers: version.annotations.map(markerSnapshot),
    updatedAt: new Date().toISOString(),
  };

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: settingsKey,
    Body: JSON.stringify(snapshot, null, 2),
    ContentType: 'application/json',
  }));

  if (version.settingsKey !== settingsKey) {
    await prisma.splatVersion.update({
      where: { id: versionId },
      data: { settingsKey },
    });
  }
}

async function syncSplatMirrorIfServed(splatId: string, versionId: string): Promise<void> {
  const splat = await prisma.splat.findUnique({ where: { id: splatId } });
  if (!splat || splat.servingVersionId !== versionId) return;
  const version = await prisma.splatVersion.findFirst({ where: { id: versionId, splatId } });
  if (!version) return;

  await prisma.splat.update({
    where: { id: splatId },
    data: {
      productionFormat: version.productionFormat,
      productionObjectKey: version.convertedKey,
      lodManifestKey: version.lodKey,
      posterKey: version.posterKey,
      splatCount: version.splatCount,
      sizeBytes: version.sizeBytes,
      boundingBoxJson: asJson(version.boundingBoxJson),
      defaultCameraJson: asJson(version.defaultCameraJson),
      globalSettingsJson: asJson(version.globalSettingsJson),
      pretransformJson: asJson(version.pretransformJson),
    },
  });
}

async function downloadOriginal(splatId: string, versionId: string, sourceKey: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const ext = getSplatExtension(sourceKey) || '.ply';
  const tmpFile = path.join(tmpDir, `gsplat-worker-${splatId}-${versionId}-${randomUUID()}-source${ext}`);

  console.log(`[worker] Downloading ${sourceKey} from S3...`);
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: sourceKey,
  }));

  if (!response.Body) throw new Error(`S3 returned an empty body for ${sourceKey}`);
  const stream = Readable.from(response.Body as AsyncIterable<Uint8Array>);
  await pipeline(stream, fs.createWriteStream(tmpFile, { flags: 'wx' }));

  const stats = await fs.promises.stat(tmpFile);
  console.log(`[worker] Downloaded ${sourceKey} to ${tmpFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  return tmpFile;
}

async function uploadAsset(splatId: string, versionId: string, localPath: string, key: string, contentType?: string): Promise<string> {
  const fullKey = `splats/${splatId}/versions/${versionId}/${key}`;
  const stats = await fs.promises.stat(localPath);

  await new Upload({
    client: s3Client,
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
    params: {
    Bucket: S3_BUCKET,
    Key: fullKey,
    Body: fs.createReadStream(localPath),
    ContentType: contentType || 'application/octet-stream',
    },
  }).done();

  console.log(`[worker] Uploaded ${fullKey} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
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
  splatCount: number;
}> {
  const stats = await fs.promises.stat(filePath);
  const format = formatFromExtension(getSplatExtension(filePath));
  const prefixHandle = await fs.promises.open(filePath, 'r');
  const prefix = Buffer.alloc(Math.min(stats.size, 64 * 1024));
  try {
    await prefixHandle.read(prefix, 0, prefix.length, 0);
  } finally {
    await prefixHandle.close();
  }

  let splatCount = 0;
  if (format === 'ply' || format === 'compressed-ply' || format === 'spz') {
    splatCount = readHeaderSplatCount(format, prefix);
  } else if (format === 'sog-meta' || format === 'lod-meta') {
    try {
      splatCount = readManifestSplatCount(JSON.parse(await fs.promises.readFile(filePath, 'utf8')));
    } catch {
      splatCount = 0;
    }
  }

  if (!Number.isFinite(splatCount) || splatCount <= 0) {
    const summary = await runSplatTransform([filePath, '--summary', 'null']);
    const match = /\*\*Row Count:\*\*\s+([\d,]+)/.exec(summary);
    splatCount = match?.[1] ? Number.parseInt(match[1].replaceAll(',', ''), 10) : 0;
  }
  if (!Number.isFinite(splatCount) || splatCount <= 0) {
    throw new Error(`Could not determine exact splat count for ${filePath}`);
  }

  return {
    format,
    fileSize: stats.size,
    splatCount,
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
  assetVariants?: AssetVariantMap;
}): Promise<void> {
  const existingVersion = await prisma.splatVersion.findUnique({
    where: { id: versionId },
    select: {
      convertedKey: true,
      lodKey: true,
      posterKey: true,
      productionFormat: true,
      splatCount: true,
      sizeBytes: true,
      globalSettingsJson: true,
      metricsJson: true,
    },
  });
  const hasUpdate = <K extends keyof typeof updates>(key: K) => Object.prototype.hasOwnProperty.call(updates, key);
  const metricsJson: Record<string, unknown> = isRecord(existingVersion?.metricsJson)
    ? { ...existingVersion.metricsJson }
    : {};
  if (hasUpdate('productionFormat')) metricsJson.format = updates.productionFormat ?? null;
  if (hasUpdate('splatCount')) metricsJson.splatCount = updates.splatCount ?? null;
  if (hasUpdate('sizeBytes')) metricsJson.fileSize = updates.sizeBytes ?? null;
  if (updates.assetVariants && Object.keys(updates.assetVariants).length > 0) {
    metricsJson.assetVariants = updates.assetVariants;
  }
  const currentVersionSettings = isRecord(existingVersion?.globalSettingsJson) ? existingVersion.globalSettingsJson : {};
  const nextVersionSettings = updates.assetVariants && Object.keys(updates.assetVariants).length > 0
    ? { ...currentVersionSettings, assetVariants: updates.assetVariants }
    : currentVersionSettings;

  await prisma.splatVersion.update({
    where: { id: versionId },
    data: {
      processingStatus: 'READY',
      convertedKey: hasUpdate('convertedKey') ? updates.convertedKey || null : existingVersion?.convertedKey ?? null,
      lodKey: hasUpdate('lodKey') ? updates.lodKey || null : existingVersion?.lodKey ?? null,
      posterKey: hasUpdate('posterKey') ? updates.posterKey || null : existingVersion?.posterKey ?? null,
      productionFormat: hasUpdate('productionFormat') ? updates.productionFormat || null : existingVersion?.productionFormat ?? null,
      splatCount: hasUpdate('splatCount') ? updates.splatCount ?? null : existingVersion?.splatCount ?? null,
      sizeBytes: hasUpdate('sizeBytes') ? (updates.sizeBytes != null ? BigInt(updates.sizeBytes) : null) : existingVersion?.sizeBytes ?? null,
      globalSettingsJson: Object.keys(nextVersionSettings).length > 0 ? asJson(nextVersionSettings) : Prisma.JsonNull,
      metricsJson: asJson(metricsJson),
    },
  });

  const splat = await prisma.splat.findUnique({
    where: { id: splatId },
    select: { servingVersionId: true, status: true },
  });
  if (splat) {
    const shouldAutoServe = !splat.servingVersionId;
    await prisma.splat.update({
      where: { id: splatId },
      data: {
        status: splat.status === 'PUBLISHED' ? 'PUBLISHED' : 'READY',
        ...(shouldAutoServe ? { servingVersionId: versionId } : {}),
      },
    });
    await syncSplatMirrorIfServed(splatId, versionId);
  }

  await syncVersionSettingsSnapshot(splatId, versionId).catch((err) => {
    console.warn(`[worker] Failed to sync settings snapshot for ${splatId}/${versionId}: ${err}`);
  });
}

// --------------------------------------------
// Asset preview helpers
// --------------------------------------------

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

function contentTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function resolveSplatTransformExecutable(): string {
  const executable = process.platform === 'win32' ? 'splat-transform.CMD' : 'splat-transform';
  const candidates = [
    path.resolve(process.cwd(), 'apps', 'worker', 'node_modules', '.bin', executable),
    path.resolve(process.cwd(), 'node_modules', '.bin', executable),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found || 'splat-transform';
}

async function runSplatTransform(args: string[]): Promise<string> {
  const executable = resolveSplatTransformExecutable();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat([...stdout, ...stderr]).toString('utf8'));
        return;
      }
      const output = Buffer.concat([...stdout, ...stderr]).toString('utf8').slice(-4000);
      reject(new Error(`splat-transform exited with ${code}: ${output}`));
    });
  });
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function uploadVariantFile(
  splatId: string,
  versionId: string,
  variantName: AssetVariantName,
  variantDir: string,
  localPath: string,
): Promise<string> {
  const relativePath = path.relative(variantDir, localPath).split(path.sep).join('/');
  const key = `splats/${splatId}/versions/${versionId}/variants/${variantName}/${relativePath}`;
  const stats = await fs.promises.stat(localPath);
  await new Upload({
    client: s3Client,
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentType: contentTypeForPath(localPath),
    },
  }).done();
  console.log(`[worker] Uploaded ${key} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  return key;
}

async function generateSplatTransformVariants(
  splatId: string,
  versionId: string,
  sourceFile: string,
  totalSplats: number,
): Promise<AssetVariantMap> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), `splat-variants-${splatId}-${versionId}-`));
  const variants: AssetVariantMap = {};

  try {
    for (const config of Object.values(SPLAT_VARIANT_CONFIGS)) {
      const targets = computeVariantTargets(totalSplats, config);
      if (targets.length === 0) continue;

      await updateVersionLog(
        versionId,
        `LOD ${config.name}: building ${targets.length} levels (${targets.map((count) => count.toLocaleString()).join(' / ')})`,
      );

      try {
      const variantDir = path.join(root, config.name);
      await fs.promises.mkdir(variantDir, { recursive: true });
      const lodFiles: string[] = [];

      for (let lod = 0; lod < targets.length; lod += 1) {
        const target = targets[lod]!;
        const lodPath = path.join(variantDir, `lod-${lod}.compressed.ply`);
        const args = [
          '-w',
          sourceFile,
          '--filter-nan',
          '--filter-harmonics',
          String(config.harmonics),
          '--morton-order',
        ];
        if (target < totalSplats) {
          args.push('--decimate', String(target));
        }
        args.push('--lod', String(lod), lodPath);
        await runSplatTransform(args);
        lodFiles.push(lodPath);
      }

      const lodManifestPath = path.join(variantDir, 'lod-meta.json');
      await runSplatTransform([
        '-w',
        ...lodFiles,
        '--iterations',
        String(config.iterations),
        '--lod-chunk-count',
        String(config.lodChunkCountK),
        '--lod-chunk-extent',
        String(config.lodChunkExtent),
        lodManifestPath,
      ]);

      const files = await collectFiles(variantDir);
      let lodManifestKey = '';
      for (const file of files) {
        const key = await uploadVariantFile(splatId, versionId, config.name, variantDir, file);
        if (path.basename(file) === 'lod-meta.json') {
          lodManifestKey = key;
        }
      }

      if (!lodManifestKey) {
        throw new Error(`splat-transform did not create lod-meta.json for ${config.name}`);
      }

      variants[config.name] = {
        format: 'lod-meta',
        lodManifestKey,
        targetSplats: targets,
        generatedAt: new Date().toISOString(),
      };
      await updateVersionLog(versionId, `LOD ${config.name}: manifest uploaded`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateVersionLog(versionId, `LOD ${config.name}: skipped after error: ${message}`);
        console.warn(`[worker] LOD ${config.name} failed for ${splatId}/${versionId}: ${message}`);
      }
    }
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  return variants;
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

async function generatePlayCanvasLod(
  job: Job<JobData>,
  splatId: string,
  versionId: string,
  sourceObjectKey: string,
): Promise<unknown> {
  await job.updateProgress(5);
  await updateVersionLog(versionId, 'Starting PlayCanvas octree LOD generation...');

  const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
  await job.updateProgress(15);

  const ext = getSplatExtension(sourceObjectKey);
  const format = formatFromExtension(ext);

  if (['ply', 'compressed-ply', 'sog', 'spz'].includes(format)) {
    try {
      await job.updateProgress(25);
      await updateVersionLog(versionId, 'Generating canonical SOG/LOD variants with splat-transform...');
      const metadata = await extractMetadata(tmpFile);
      const assetVariants = await generateSplatTransformVariants(
        splatId,
        versionId,
        tmpFile,
        metadata.splatCount,
      );
      const desktopVariant = assetVariants.desktop ?? assetVariants.mobile ?? assetVariants.vr;
      if (!desktopVariant) {
        throw new Error('splat-transform did not produce a usable desktop/mobile/vr variant');
      }

      await fs.promises.unlink(tmpFile).catch(() => {});
      await markVersionReady(splatId, versionId, {
        convertedKey: desktopVariant.lodManifestKey,
        productionFormat: 'lod-meta',
        lodKey: desktopVariant.lodManifestKey,
        splatCount: metadata.splatCount,
        sizeBytes: metadata.fileSize,
        assetVariants,
      });
      await job.updateProgress(100);
      await updateVersionLog(versionId, `SplatTransform LOD ready: ${Object.keys(assetVariants).join(', ')}`);
      return {
        splatCount: metadata.splatCount,
        assetVariants,
        productionObjectKey: desktopVariant.lodManifestKey,
        productionFormat: 'lod-meta',
      };
    } catch (variantError) {
      const message = variantError instanceof Error ? variantError.message : String(variantError);
      await updateVersionLog(versionId, `SplatTransform LOD failed, falling back to legacy PLY packer: ${message}`);
      console.warn(`[worker] SplatTransform LOD failed for ${splatId}/${versionId}: ${message}`);
    }
  }

  if (format !== 'ply') {
    await fs.promises.unlink(tmpFile).catch(() => {});
    await updateVersionLog(versionId, `LOD generation skipped: format "${format}" not supported for octree LOD. Use standard binary PLY input.`);
    await markVersionReady(splatId, versionId, {});
    await job.updateProgress(100);
    return { skipped: true, reason: `Unsupported format: ${format}` };
  }

  const fileBuffer = await fs.promises.readFile(tmpFile);
  const headerStr = fileBuffer.toString('ascii', 0, Math.min(fileBuffer.length, 16_384));
  const isAscii = /^ply\r?\nformat ascii/.test(headerStr);
  const isBinary = /^ply\r?\nformat binary_little_endian/.test(headerStr);

  if (isAscii) {
    await fs.promises.unlink(tmpFile).catch(() => {});
    await updateVersionLog(versionId, 'LOD skipped: ASCII PLY is not supported by the production LOD packer. Convert to binary PLY first.');
    await markVersionReady(splatId, versionId, {});
    await job.updateProgress(100);
    return { skipped: true, reason: 'ASCII PLY is not supported for LOD generation' };
  }

  if (!isBinary) {
    await fs.promises.unlink(tmpFile).catch(() => {});
    await updateVersionLog(versionId, 'LOD skipped: unrecognized PLY format');
    await markVersionReady(splatId, versionId, {});
    await job.updateProgress(100);
    return { skipped: true, reason: 'Unrecognized PLY format' };
  }

  const vMatch = /element vertex (\d+)/.exec(headerStr);
  const totalVertices = vMatch?.[1] ? parseInt(vMatch[1], 10) : 0;
  const headerEndLf = fileBuffer.indexOf('end_header\n');
  const headerEndCrlf = fileBuffer.indexOf('end_header\r\n');
  const dataStart = headerEndCrlf >= 0
    ? headerEndCrlf + 'end_header\r\n'.length
    : headerEndLf >= 0
      ? headerEndLf + 'end_header\n'.length
      : 0;
  const vertexSize = 62 * 4;

  if (totalVertices === 0 || dataStart === 0 || dataStart + vertexSize > fileBuffer.length) {
    await fs.promises.unlink(tmpFile).catch(() => {});
    await updateVersionLog(versionId, 'LOD skipped: could not parse binary PLY vertex payload');
    await markVersionReady(splatId, versionId, {});
    await job.updateProgress(100);
    return { skipped: true, reason: 'Could not parse binary PLY payload' };
  }

  await updateVersionLog(versionId, `Parsed binary PLY: ${totalVertices.toLocaleString()} vertices`);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  const vertices: LodSourceVertex[] = [];

  for (let i = 0; i < totalVertices; i++) {
    const offset = dataStart + i * vertexSize;
    if (offset + vertexSize > fileBuffer.length) break;

    const x = fileBuffer.readFloatLE(offset);
    const y = fileBuffer.readFloatLE(offset + 4);
    const z = fileBuffer.readFloatLE(offset + 8);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    const rawOpacity = fileBuffer.readFloatLE(offset + 54 * 4);
    const opacity = Number.isFinite(rawOpacity) ? 1 / (1 + Math.exp(-rawOpacity)) : 0;
    const sx = Math.exp(Math.min(20, fileBuffer.readFloatLE(offset + 55 * 4)));
    const sy = Math.exp(Math.min(20, fileBuffer.readFloatLE(offset + 56 * 4)));
    const sz = Math.exp(Math.min(20, fileBuffer.readFloatLE(offset + 57 * 4)));
    const maxScale = Math.max(
      Number.isFinite(sx) ? sx : 0,
      Number.isFinite(sy) ? sy : 0,
      Number.isFinite(sz) ? sz : 0,
      1e-6,
    );
    const importance = opacity * maxScale;

    vertices.push({ x, y, z, offset, importance });
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  if (vertices.length === 0 || !Number.isFinite(minX)) {
    await fs.promises.unlink(tmpFile).catch(() => {});
    await updateVersionLog(versionId, 'LOD skipped: no valid splat positions found');
    await markVersionReady(splatId, versionId, {});
    await job.updateProgress(100);
    return { skipped: true, reason: 'No valid splat positions found' };
  }

  await job.updateProgress(30);

  const gridSize = 8;
  const cellSizeX = (maxX - minX) / gridSize || 1;
  const cellSizeY = (maxY - minY) / gridSize || 1;
  const cellSizeZ = (maxZ - minZ) / gridSize || 1;

  interface Cell {
    cx: number;
    cy: number;
    cz: number;
    vertices: LodSourceVertex[];
  }

  const cellMap = new Map<string, Cell>();
  for (const vertex of vertices) {
    const cx = Math.max(0, Math.min(gridSize - 1, Math.floor((vertex.x - minX) / cellSizeX)));
    const cy = Math.max(0, Math.min(gridSize - 1, Math.floor((vertex.y - minY) / cellSizeY)));
    const cz = Math.max(0, Math.min(gridSize - 1, Math.floor((vertex.z - minZ) / cellSizeZ)));
    const key = `${cx}_${cy}_${cz}`;
    const cell = cellMap.get(key);
    if (cell) {
      cell.vertices.push(vertex);
    } else {
      cellMap.set(key, { cx, cy, cz, vertices: [vertex] });
    }
  }

  await updateVersionLog(versionId, `Built ${cellMap.size} LOD cells from ${vertices.length.toLocaleString()} valid positions`);
  await job.updateProgress(45);

  const lodLevels = [
    { filename: 'lod-0.ply', ratio: 1 },
    { filename: 'lod-1.ply', ratio: 0.2 },
    { filename: 'lod-2.ply', ratio: 0.05 },
    { filename: 'lod-3.ply', ratio: 0.01 },
  ] as const;
  const filenames = lodLevels.map((level) => level.filename);
  const lodBodies: Buffer[][] = lodLevels.map(() => []);
  const lodVertexCounts = lodLevels.map(() => 0);
  const cellsForManifest: LodCellManifestInput[] = [];

  for (const cell of cellMap.values()) {
    const lods: LodCellManifestInput['lods'] = [];
    const cellBound = {
      min: [
        minX + cell.cx * cellSizeX,
        minY + cell.cy * cellSizeY,
        minZ + cell.cz * cellSizeZ,
      ] as [number, number, number],
      max: [
        minX + (cell.cx + 1) * cellSizeX,
        minY + (cell.cy + 1) * cellSizeY,
        minZ + (cell.cz + 1) * cellSizeZ,
      ] as [number, number, number],
    };

    for (let lodIndex = 0; lodIndex < lodLevels.length; lodIndex++) {
      const level = lodLevels[lodIndex]!;
      const sampleCount = Math.max(1, Math.round(cell.vertices.length * level.ratio));
      const sampled = level.ratio >= 1
        ? cell.vertices.slice()
        : sampleLodVertices(cell.vertices, sampleCount);
      const offset = lodVertexCounts[lodIndex]!;
      const count = sampled.length;
      const lodData = Buffer.alloc(count * vertexSize);

      for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
        const srcOffset = sampled[sampleIndex]!.offset;
        fileBuffer.copy(lodData, sampleIndex * vertexSize, srcOffset, srcOffset + vertexSize);
      }

      lodBodies[lodIndex]!.push(lodData);
      lodVertexCounts[lodIndex] = offset + count;
      lods[lodIndex] = { file: lodIndex, offset, count };
    }

    cellsForManifest.push({ bound: cellBound, lods });
  }

  await job.updateProgress(65);

  for (let lodIndex = 0; lodIndex < lodLevels.length; lodIndex++) {
    const body = Buffer.concat(lodBodies[lodIndex]!, lodVertexCounts[lodIndex]! * vertexSize);
    const lodBuffer = Buffer.concat([buildPlyHeader(lodVertexCounts[lodIndex]!), body]);
    const lodKey = `splats/${splatId}/versions/${versionId}/${filenames[lodIndex]!}`;
    await writeBuffer(lodKey, lodBuffer);
  }

  const lodMeta = createPlayCanvasLodManifest({
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    filenames,
    cells: cellsForManifest,
  });
  const lodMetaBuf = Buffer.from(JSON.stringify(lodMeta), 'utf-8');
  const lodMetaKey = `splats/${splatId}/versions/${versionId}/lod-meta.json`;
  await writeBuffer(lodMetaKey, lodMetaBuf);

  const fullSceneKey = `splats/${splatId}/versions/${versionId}/scene.ply`;
  const fullData = Buffer.alloc(vertices.length * vertexSize);
  for (let i = 0; i < vertices.length; i++) {
    const srcOffset = vertices[i]!.offset;
    fileBuffer.copy(fullData, i * vertexSize, srcOffset, srcOffset + vertexSize);
  }
  await writeBuffer(fullSceneKey, Buffer.concat([buildPlyHeader(vertices.length), fullData]));

  await fs.promises.unlink(tmpFile).catch(() => {});

  await job.updateProgress(90);
  await updateVersionLog(
    versionId,
    `LOD generation complete: ${filenames.length} packed files, ${cellMap.size} cells, counts ${lodVertexCounts.join(' / ')}`,
  );

  await markVersionReady(splatId, versionId, {
    convertedKey: lodMetaKey,
    productionFormat: 'lod-meta',
    lodKey: lodMetaKey,
    splatCount: vertices.length,
    sizeBytes: lodMetaBuf.length,
  });

  await job.updateProgress(100);
  await updateVersionLog(versionId, `LOD ready: PlayCanvas lod-meta.json with ${vertices.length.toLocaleString()} source splats`);
  return {
    cellCount: cellMap.size,
    splatCount: vertices.length,
    lodLevels: lodLevels.length,
    filenames,
    fallbackObjectKey: fullSceneKey,
  };
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

async function markVersionFailed(
  versionId: string,
  splatId: string,
  stage: string,
  errorMessage: string,
): Promise<void> {
  const version = await prisma.splatVersion.findUnique({
    where: { id: versionId },
    select: { processingLog: true },
  });
  const failureLine = `STAGE ${stage} FAILED: ${errorMessage}`;
  await prisma.splatVersion.update({
    where: { id: versionId },
    data: {
      processingStatus: 'FAILED',
      processingLog: version?.processingLog
        ? `${version.processingLog}\n${failureLine}`
        : failureLine,
    },
  });

  const splat = await prisma.splat.findUnique({
    where: { id: splatId },
    select: { status: true, servingVersionId: true },
  });
  if (splat && splat.status !== 'PUBLISHED') {
    await prisma.splat.update({
      where: { id: splatId },
      data: { status: splat.servingVersionId ? 'READY' : 'FAILED' },
    });
  }
}

// Process a single job
async function processJob(job: Job<JobData>): Promise<unknown> {
  const { splatId, versionId, sourceObjectKey, jobType } = job.data;
  let activeStage = jobType.replace('splat.', '');
  console.log(`[worker] Processing job ${job.id}: type=${jobType}, splat=${splatId}, version=${versionId}`);

  await job.updateProgress(5);
  await updateVersionLog(versionId, `[${new Date().toISOString()}] Starting ${jobType}`);

  try {
    switch (jobType) {
      case 'splat.validate': {
        activeStage = 'validation';
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
        activeStage = 'metadata';
        if (!sourceObjectKey) throw new Error('sourceObjectKey is required for metadata extraction');
        const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
        await job.updateProgress(30);
        await updateVersionLog(versionId, 'Extracting metadata...');
        const metadata = await extractMetadata(tmpFile);
        await fs.promises.unlink(tmpFile).catch(() => {});
        await job.updateProgress(100);
        await updateVersionLog(versionId, `Metadata extracted: ${metadata.splatCount.toLocaleString()} splats (exact)`);
        return metadata;
      }

      case 'splat.convert': {
        if (!sourceObjectKey) throw new Error('sourceObjectKey is required for conversion');
        activeStage = 'validation';
        await updateVersionLog(versionId, 'STAGE validation STARTED');
        const tmpFile = await downloadOriginal(splatId, versionId, sourceObjectKey);
        try {
        await job.updateProgress(12);
        const validation = await validateFile(tmpFile);
        await updateVersionLog(
          versionId,
          `STAGE validation COMPLETED: ${validation.format}, ${validation.fileSize.toLocaleString()} bytes`,
        );

        activeStage = 'metadata';
        await job.updateProgress(20);
        await updateVersionLog(versionId, 'STAGE metadata STARTED');
        const metadata = await extractMetadata(tmpFile);
        await updateVersionLog(
          versionId,
          `STAGE metadata COMPLETED: ${metadata.splatCount.toLocaleString()} splats`,
        );

        activeStage = 'conversion';
        await job.updateProgress(30);
        await updateVersionLog(versionId, 'STAGE conversion STARTED');

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

        const splatCount = metadata.splatCount;
        let assetVariants: AssetVariantMap | undefined;

        if (['ply', 'compressed-ply', 'sog', 'spz'].includes(productionFormat)) {
          activeStage = 'lod';
          try {
            await job.updateProgress(45);
            await updateVersionLog(versionId, 'STAGE lod STARTED');
            assetVariants = await generateSplatTransformVariants(splatId, versionId, tmpFile, splatCount);
            const generatedVariants = Object.keys(assetVariants);
            if (generatedVariants.length > 0) {
              await updateVersionLog(versionId, `STAGE lod COMPLETED: ${generatedVariants.join(', ')}`);
            } else {
              await updateVersionLog(versionId, 'STAGE lod SKIPPED: no usable variants were produced');
            }
          } catch (variantError) {
            const message = variantError instanceof Error ? variantError.message : String(variantError);
            console.warn(`[worker] Variant generation failed for ${splatId}/${versionId}: ${message}`);
            await updateVersionLog(versionId, `STAGE lod SKIPPED: ${message}`);
          }
        } else {
          await updateVersionLog(versionId, `STAGE lod SKIPPED: ${productionFormat} input already supplies its production representation`);
        }

        activeStage = 'conversion';
        await job.updateProgress(90);
        const desktopVariant = assetVariants?.desktop;
        const readyKey = desktopVariant?.lodManifestKey || fullKey;
        const readyFormat = desktopVariant ? 'lod-meta' : productionFormat;

        await updateVersionLog(
          versionId,
          `STAGE conversion COMPLETED: ${readyFormat}, ${splatCount.toLocaleString()} splats`,
        );

        // READY is written last so clients always receive the complete stage log.
        await markVersionReady(splatId, versionId, {
          convertedKey: readyKey,
          productionFormat: readyFormat,
          lodKey: readyFormat === 'lod-meta' ? readyKey : undefined,
          metaKey: readyFormat === 'sog-meta' ? readyKey : undefined,
          splatCount,
          sizeBytes: stats.size,
          assetVariants,
        });

        await job.updateProgress(100);

        return {
          productionObjectKey: readyKey,
          productionFormat: readyFormat,
          splatCount,
          fileSize: stats.size,
          assetVariants,
        };
        } finally {
          await fs.promises.unlink(tmpFile).catch(() => undefined);
        }
      }

      case 'splat.generateLod': {
        activeStage = 'lod';
        if (!sourceObjectKey) throw new Error('sourceObjectKey required for LOD generation');
        return generatePlayCanvasLod(job, splatId, versionId, sourceObjectKey);
      }

      case 'splat.generatePreview': {
        activeStage = 'preview';
        await job.updateProgress(10);
        await updateVersionLog(versionId, 'Generating poster image...');

        // Try this version's converted key first, then source key.
        const versionRecord = await prisma.splatVersion.findUnique({
          where: { id: versionId },
          select: { convertedKey: true, sourceKey: true },
        });

        let previewKey = versionRecord?.convertedKey || sourceObjectKey || versionRecord?.sourceKey;
        if (!previewKey) throw new Error('No source or production key available for preview');

        let tmpFile: string;
        let posterBuffer: Buffer;
        try {
          tmpFile = await downloadOriginal(splatId, versionId, previewKey);
          posterBuffer = await generatePoster(tmpFile);
        } catch (posterErr) {
          // If production key fails, try source key
          const fallbackKey = versionRecord?.sourceKey || sourceObjectKey;
          if (fallbackKey && fallbackKey !== previewKey) {
            await updateVersionLog(versionId, `Production key failed for poster, trying source key...`);
            previewKey = fallbackKey;
            tmpFile = await downloadOriginal(splatId, versionId, previewKey);
            posterBuffer = await generatePoster(tmpFile);
          } else {
            throw posterErr;
          }
        }

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

        await syncVersionSettingsSnapshot(splatId, versionId).catch(() => undefined);
        await syncSplatMirrorIfServed(splatId, versionId);

        await fs.promises.unlink(tmpFile).catch(() => {});
        await job.updateProgress(100);
        await updateVersionLog(versionId, `Preview generation complete: poster at ${posterKey}`);
        return { posterKey };
      }

      case 'splat.applyPretransform': {
        await job.updateProgress(5);
        await updateVersionLog(versionId, 'Checking pretransform settings...');

        const versionRecord = await prisma.splatVersion.findUnique({
          where: { id: versionId },
          select: { pretransformJson: true, convertedKey: true, productionFormat: true },
        });

        if (!versionRecord?.pretransformJson) {
          await updateVersionLog(versionId, 'No pretransform set; nothing to apply.');
          await job.updateProgress(100);
          return { skipped: true, reason: 'No pretransform' };
        }

        const pretransform = versionRecord.pretransformJson as {
          position: [number, number, number];
          rotation: [number, number, number];
          scale: [number, number, number];
        };

        await updateVersionLog(versionId,
          `Applying pretransform: pos=[${pretransform.position.join(',')}], rot=[${pretransform.rotation.join(',')}], scale=[${pretransform.scale.join(',')}]`
        );

        const fmt = versionRecord.productionFormat || 'ply';
        if (fmt !== 'ply' && fmt !== 'compressed-ply') {
          await updateVersionLog(versionId, `Pretransform skipped: cannot transform format "${fmt}"`);
          await job.updateProgress(100);
          return { skipped: true, reason: `Unsupported format: ${fmt}` };
        }

        const prodKey = versionRecord.convertedKey || sourceObjectKey;
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

        await prisma.splatVersion.update({
          where: { id: versionId },
          data: { convertedKey: transformedKey },
        });
        await syncVersionSettingsSnapshot(splatId, versionId).catch(() => undefined);
        await syncSplatMirrorIfServed(splatId, versionId);

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
    if (jobType === 'splat.generateLod' || jobType === 'splat.generatePreview') {
      const usableVersion = await prisma.splatVersion.findUnique({
        where: { id: versionId },
        select: { processingStatus: true, convertedKey: true },
      });
      if (usableVersion?.processingStatus === 'READY' || usableVersion?.convertedKey) {
        await updateVersionLog(versionId, `STAGE ${activeStage} SKIPPED: ${error.message}`);
        if (usableVersion.processingStatus !== 'READY') {
          await markVersionReady(splatId, versionId, {});
        }
        return { skipped: true, reason: error.message };
      }
    }
    await markVersionFailed(versionId, splatId, activeStage, error.message);
    throw error;
  }
}

async function start() {
  console.log('[worker] Starting GSplat worker...');

  const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of await fs.promises.readdir(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.name.startsWith('gsplat-worker-') && !entry.name.startsWith('splat-variants-')) continue;
    const candidate = path.resolve(os.tmpdir(), entry.name);
    if (path.dirname(candidate) !== path.resolve(os.tmpdir())) continue;
    try {
      const stats = await fs.promises.stat(candidate);
      if (stats.mtimeMs < staleBefore) {
        await fs.promises.rm(candidate, { recursive: entry.isDirectory(), force: true });
      }
    } catch (error) {
      console.warn(`[worker] Could not clean stale temp path ${candidate}:`, error);
    }
  }

  // Connect to database
  await prisma.$connect();
  console.log('[worker] Connected to PostgreSQL');

  // Log all existing splats for debugging
  const splatCount = await prisma.splat.count();
  console.log(`[worker] Found ${splatCount} splats in database`);

  await ensureBucket();

  const configuredConcurrency = Number.parseInt(process.env.WORKER_CONCURRENCY || '1', 10);
  const worker = new Worker<JobData>('splat-processing', processJob, {
    connection: redisConnection,
    concurrency: Number.isFinite(configuredConcurrency) ? Math.max(1, Math.min(configuredConcurrency, 4)) : 1,
  });

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', async (job, error) => {
    console.error(`[worker] Job ${job?.id} failed:`, error.message);
    if (!job) return;
    const current = await prisma.splatVersion.findUnique({
      where: { id: job.data.versionId },
      select: { processingStatus: true },
    }).catch(() => null);
    if (current?.processingStatus === 'RUNNING') {
      const stage = job.data.jobType === 'splat.convert'
        ? 'worker'
        : job.data.jobType.replace('splat.', '');
      await markVersionFailed(job.data.versionId, job.data.splatId, stage, error.message).catch((markError) => {
        console.error(`[worker] Could not persist terminal job failure for ${job?.id}:`, markError);
      });
    }
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
