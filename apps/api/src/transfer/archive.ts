import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  DeleteBucketPolicyCommand,
  DeleteBucketCorsCommand,
  DeleteBucketLifecycleCommand,
  DeleteBucketTaggingCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { PrismaClient } from '@prisma/client';
import { captureRuntimeConfig, serializeEnv, type TransferRuntimeConfig } from './config.js';
import { createCryptoDescriptor, decryptFile, deriveTransferKeys, encryptFile, manifestHmac, verifyManifestHmac } from './crypto.js';
import {
  TRANSFER_ARCHIVE_VERSION,
  type TransferDatabaseTable,
  type TransferManifest,
  type TransferObjectEntry,
  type TransferProgress,
} from './types.js';
import { assertRegularFile, assertSafeRelativePath, canonicalJson, sha256File, sha256Text } from './utils.js';

const TABLE_QUERY = `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;

function databaseEnvironment(databaseUrl = process.env.DATABASE_URL || '') {
  const parsed = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.replace(/^\//, ''),
  };
}

function databaseName(databaseUrl = process.env.DATABASE_URL || '') {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
}

async function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

export function buildS3Client() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  });
}

async function databaseStats(prisma: PrismaClient): Promise<TransferDatabaseTable[]> {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(TABLE_QUERY);
  const output: TransferDatabaseTable[] = [];
  for (const { name } of tables) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsafe database table name: ${name}`);
    const quoted = `"${name}"`;
    const [result] = await prisma.$queryRawUnsafe<Array<{ rows: bigint; digest: string }>>(
      `SELECT count(*)::bigint AS rows, md5(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS digest FROM ${quoted} t`,
    );
    output.push({ name, rows: Number(result?.rows ?? 0), digest: result?.digest ?? '' });
  }
  return output;
}

async function listObjectKeys(s3: S3Client, bucket: string) {
  const output: Array<{ key: string; size: number; etag?: string; lastModified?: Date }> = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const item of page.Contents ?? []) {
      if (item.Key) output.push({ key: item.Key, size: item.Size ?? 0, etag: item.ETag, lastModified: item.LastModified });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return output.sort((a, b) => a.key.localeCompare(b.key));
}

async function writeObject(s3: S3Client, bucket: string, key: string, target: string) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Object ${key} has an empty body`);
  const hash = createHash('sha256');
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(response.Body as NodeJS.ReadableStream, counter, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  return hash.digest('hex');
}

async function hashObject(s3: S3Client, bucket: string, key: string) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Object ${key} has an empty body`);
  const hash = createHash('sha256');
  for await (const chunk of response.Body as any) hash.update(chunk);
  return hash.digest('hex');
}

async function readBucketConfiguration(s3: S3Client, bucket: string) {
  const optional = async (name: string, command: any) => {
    try {
      return { name, value: await s3.send(command as any) };
    } catch (error: any) {
      if (['NoSuchBucketPolicy', 'NoSuchCORSConfiguration', 'NoSuchLifecycleConfiguration', 'NoSuchTagSet', 'NotImplemented'].includes(error?.name)) return { name, value: null };
      throw error;
    }
  };
  const items = await Promise.all([
    optional('policy', new GetBucketPolicyCommand({ Bucket: bucket })),
    optional('cors', new GetBucketCorsCommand({ Bucket: bucket })),
    optional('lifecycle', new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })),
    optional('tags', new GetBucketTaggingCommand({ Bucket: bucket })),
    optional('versioning', new GetBucketVersioningCommand({ Bucket: bucket })),
  ]);
  return Object.fromEntries(items.map(({ name, value }) => [name, value]));
}

async function writeProgress(root: string, progress: TransferProgress) {
  const jobs = path.join(root, '.jobs');
  await mkdir(jobs, { recursive: true });
  progress.updatedAt = new Date().toISOString();
  await writeFile(path.join(jobs, `${progress.id}.json`), JSON.stringify(progress, null, 2), { mode: 0o600 });
}

export interface ExportOptions {
  prisma: PrismaClient;
  passphrase: string;
  backupsRoot: string;
  name?: string;
  config?: TransferRuntimeConfig;
  onProgress?: (progress: TransferProgress) => void;
}

export async function exportProject(options: ExportOptions) {
  const id = options.name?.replace(/[^a-zA-Z0-9._-]/g, '-') || `project-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const partial = path.join(options.backupsRoot, `${id}.partial`);
  const completed = path.join(options.backupsRoot, id);
  await mkdir(options.backupsRoot, { recursive: true });
  await access(completed).then(() => { throw new Error(`Archive already exists: ${completed}`); }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await rm(partial, { recursive: true, force: true });
  await mkdir(path.join(partial, 'objects'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(partial, 'bucket'), { recursive: true, mode: 0o700 });

  const progress: TransferProgress = {
    id, operation: 'export', status: 'running', phase: 'initializing', objectsDone: 0, objectsTotal: 0,
    bytesDone: 0, bytesTotal: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const update = async (patch: Partial<TransferProgress>) => {
    Object.assign(progress, patch);
    await writeProgress(options.backupsRoot, progress);
    options.onProgress?.({ ...progress });
  };

  const descriptor = createCryptoDescriptor();
  const keys = await deriveTransferKeys(options.passphrase, descriptor);
  const s3 = buildS3Client();
  const bucket = process.env.S3_BUCKET || 'gsplat-assets';
  const rawDump = path.join(partial, '.database.dump');
  const rawConfig = path.join(partial, '.runtime.env');

  try {
    await update({ phase: 'database' });
    const tables = await databaseStats(options.prisma);
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', rawDump], { env: databaseEnvironment() });
    await encryptFile(rawDump, path.join(partial, 'database.dump.enc'), keys.encryptionKey);
    await rm(rawDump, { force: true });

    const config = options.config ?? captureRuntimeConfig();
    await writeFile(rawConfig, serializeEnv(config), { mode: 0o600 });
    await encryptFile(rawConfig, path.join(partial, 'runtime.env.enc'), keys.encryptionKey);
    await rm(rawConfig, { force: true });

    const objects = await listObjectKeys(s3, bucket);
    await update({ phase: 'objects', objectsTotal: objects.length, bytesTotal: objects.reduce((sum, item) => sum + item.size, 0) });
    const objectEntries: TransferObjectEntry[] = [];
    for (const item of objects) {
      const fileId = sha256Text(item.key);
      const relative = `objects/${fileId.slice(0, 2)}/${fileId}`;
      const target = path.join(partial, ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const [sha256, head] = await Promise.all([
        writeObject(s3, bucket, item.key, target),
        s3.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key })),
      ]);
      objectEntries.push({
        fileId, path: relative, key: item.key, size: item.size, sha256,
        etag: item.etag?.replaceAll('"', ''), lastModified: item.lastModified?.toISOString(),
        contentType: head.ContentType, contentEncoding: head.ContentEncoding,
        cacheControl: head.CacheControl, contentDisposition: head.ContentDisposition, metadata: head.Metadata,
      });
      await update({ objectsDone: progress.objectsDone + 1, bytesDone: progress.bytesDone + item.size });
    }

    await update({ phase: 'bucket-configuration' });
    const bucketConfig = await readBucketConfiguration(s3, bucket);
    for (const [name, value] of Object.entries(bucketConfig)) {
      await writeFile(path.join(partial, 'bucket', `${name}.json`), canonicalJson(value), { mode: 0o600 });
    }

    const bucketFiles = await Promise.all(Object.keys(bucketConfig).sort().map(async (name) => {
      const relative = `bucket/${name}.json`;
      const absolute = path.join(partial, 'bucket', `${name}.json`);
      return { fileId: `bucket-${name}`, path: relative, size: (await stat(absolute)).size, sha256: await sha256File(absolute), encrypted: false };
    }));

    const schemaPath = process.env.PRISMA_SCHEMA_PATH || path.resolve('apps/api/prisma/schema.prisma');
    const databaseFile = path.join(partial, 'database.dump.enc');
    const configFile = path.join(partial, 'runtime.env.enc');
    const manifest: TransferManifest = {
      archiveVersion: TRANSFER_ARCHIVE_VERSION,
      id,
      createdAt: new Date().toISOString(),
      appVersion: process.env.npm_package_version || '0.1.0',
      buildCommit: process.env.BUILD_COMMIT || null,
      prismaSchemaSha256: sha256Text(await readFile(schemaPath)),
      database: { tables, totalRows: tables.reduce((sum, table) => sum + table.rows, 0) },
      objects: objectEntries,
      objectBytes: objectEntries.reduce((sum, item) => sum + item.size, 0),
      bucket,
      configKeys: Object.keys(config).sort(),
      files: [
        { fileId: 'database', path: 'database.dump.enc', size: (await stat(databaseFile)).size, sha256: await sha256File(databaseFile), encrypted: true },
        { fileId: 'runtime-config', path: 'runtime.env.enc', size: (await stat(configFile)).size, sha256: await sha256File(configFile), encrypted: true },
        ...bucketFiles,
        ...objectEntries.map(({ fileId, path: objectPath, size, sha256 }) => ({ fileId, path: objectPath, size, sha256, encrypted: false })),
      ],
    };
    const manifestBytes = Buffer.from(canonicalJson(manifest));
    await writeFile(path.join(partial, 'crypto.json'), canonicalJson(descriptor), { mode: 0o600 });
    await writeFile(path.join(partial, 'manifest.json'), manifestBytes, { mode: 0o600 });
    await writeFile(path.join(partial, 'manifest.hmac'), manifestHmac(manifestBytes, keys.hmacKey), { mode: 0o600 });
    await rename(partial, completed);
    await update({ status: 'completed', phase: 'completed', message: completed });
    return { path: completed, manifest };
  } catch (error) {
    await update({ status: 'failed', phase: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await rm(rawDump, { force: true }).catch(() => undefined);
    await rm(rawConfig, { force: true }).catch(() => undefined);
  }
}

export interface ValidatedArchive {
  root: string;
  manifest: TransferManifest;
  encryptionKey: Buffer;
}

export async function validateArchive(root: string, passphrase: string, options: { verifySchema?: boolean } = {}): Promise<ValidatedArchive> {
  const descriptor = JSON.parse(await readFile(path.join(root, 'crypto.json'), 'utf8'));
  const keys = await deriveTransferKeys(passphrase, descriptor);
  const manifestBytes = await readFile(path.join(root, 'manifest.json'));
  const expectedHmac = await readFile(path.join(root, 'manifest.hmac'), 'utf8');
  if (!verifyManifestHmac(manifestBytes, expectedHmac, keys.hmacKey)) throw new Error('Archive manifest authentication failed');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as TransferManifest;
  if (manifest.archiveVersion !== TRANSFER_ARCHIVE_VERSION) throw new Error(`Unsupported archive version: ${manifest.archiveVersion}`);
  if (!/^[a-zA-Z0-9._-]+$/.test(manifest.id)) throw new Error('Archive identifier is invalid');
  if (new Set(manifest.files.map((file) => file.fileId)).size !== manifest.files.length) throw new Error('Archive contains duplicate file identifiers');
  if (new Set(manifest.objects.map((object) => object.key)).size !== manifest.objects.length) throw new Error('Archive contains duplicate object keys');
  const fileIds = new Set(manifest.files.map((file) => file.fileId));
  if (manifest.objects.some((object) => !fileIds.has(object.fileId))) throw new Error('Archive object inventory references a missing file');
  if (options.verifySchema !== false) {
    const schemaPath = process.env.PRISMA_SCHEMA_PATH || path.resolve('apps/api/prisma/schema.prisma');
    const localSchema = sha256Text(await readFile(schemaPath));
    if (localSchema !== manifest.prismaSchemaSha256) throw new Error('Archive Prisma schema does not match this application build');
  }
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path);
    const absolute = path.join(root, ...file.path.split('/'));
    const fileStat = await assertRegularFile(absolute, root);
    if (fileStat.size !== file.size) throw new Error(`Archive file size mismatch: ${file.path}`);
    if (await sha256File(absolute) !== file.sha256) throw new Error(`Archive checksum mismatch: ${file.path}`);
  }
  return { root, manifest, encryptionKey: keys.encryptionKey };
}

async function targetIsFresh(prisma: PrismaClient, s3: S3Client, bucket: string) {
  const [splats, versions, annotations, presets, objects] = await Promise.all([
    prisma.splat.count(), prisma.splatVersion.count(), prisma.annotation.count(), prisma.viewerPreset.count(), listObjectKeys(s3, bucket),
  ]);
  return splats === 0 && versions === 0 && annotations === 0 && presets === 0 && objects.length === 0;
}

async function restoreBucketConfiguration(s3: S3Client, bucket: string, root: string) {
  const load = async (name: string) => JSON.parse(await readFile(path.join(root, 'bucket', `${name}.json`), 'utf8'));
  const policy = await load('policy').catch(() => null);
  const cors = await load('cors').catch(() => null);
  const lifecycle = await load('lifecycle').catch(() => null);
  const tags = await load('tags').catch(() => null);
  const versioning = await load('versioning').catch(() => null);
  if (policy?.Policy) await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy.Policy }));
  else await s3.send(new DeleteBucketPolicyCommand({ Bucket: bucket })).catch(() => undefined);
  if (cors?.CORSRules) await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: cors.CORSRules } }));
  else await s3.send(new DeleteBucketCorsCommand({ Bucket: bucket })).catch(() => undefined);
  if (lifecycle?.Rules) await s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: { Rules: lifecycle.Rules } }));
  else await s3.send(new DeleteBucketLifecycleCommand({ Bucket: bucket })).catch(() => undefined);
  if (tags?.TagSet) await s3.send(new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet: tags.TagSet } }));
  else await s3.send(new DeleteBucketTaggingCommand({ Bucket: bucket })).catch(() => undefined);
  await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: versioning?.Status || 'Suspended' } })).catch(() => undefined);
}

async function putArchiveObjects(archive: ValidatedArchive, s3: S3Client, bucket: string) {
  const wanted = new Set(archive.manifest.objects.map((object) => object.key));
  for (const object of archive.manifest.objects) {
    const absolute = path.join(archive.root, ...object.path.split('/'));
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: object.key, Body: createReadStream(absolute), ContentLength: object.size,
      ContentType: object.contentType, ContentEncoding: object.contentEncoding,
      CacheControl: object.cacheControl, ContentDisposition: object.contentDisposition, Metadata: object.metadata,
    }));
    if (await hashObject(s3, bucket, object.key) !== object.sha256) throw new Error(`Restored object checksum mismatch: ${object.key}`);
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    if (head.ContentLength !== object.size || (object.contentType && head.ContentType !== object.contentType)) {
      throw new Error(`Restored object metadata mismatch: ${object.key}`);
    }
  }
  const existing = await listObjectKeys(s3, bucket);
  const remove = existing.filter((item) => !wanted.has(item.key)).map((item) => ({ Key: item.key }));
  for (let index = 0; index < remove.length; index += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: remove.slice(index, index + 1000), Quiet: true } }));
  }
  await restoreBucketConfiguration(s3, bucket, archive.root);
}

async function restoreDatabase(archive: ValidatedArchive, temporaryRoot: string) {
  const dump = path.join(temporaryRoot, `restore-${randomUUID()}.dump`);
  await decryptFile(path.join(archive.root, 'database.dump.enc'), dump, archive.encryptionKey);
  try {
    await run('pg_restore', [
      '--dbname', databaseName(), '--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges', dump,
    ], { env: databaseEnvironment() });
  } finally {
    await rm(dump, { force: true });
  }
}

export async function importProject(options: {
  prisma: PrismaClient;
  archiveRoot: string;
  backupsRoot: string;
  passphrase: string;
  mode: 'fresh' | 'replace';
  confirmed?: boolean;
  createSafetyBackup?: boolean;
}) {
  const archive = await validateArchive(options.archiveRoot, options.passphrase);
  const s3 = buildS3Client();
  const bucket = process.env.S3_BUCKET || 'gsplat-assets';
  const fresh = await targetIsFresh(options.prisma, s3, bucket);
  if (options.mode === 'fresh' && !fresh) throw new Error('Destination contains project data; use explicit replace mode');
  if (options.mode === 'replace' && !options.confirmed) throw new Error('Replace mode requires explicit confirmation');

  let safetyPath: string | undefined;
  if (options.mode === 'replace' && options.createSafetyBackup !== false) {
    const targetObjects = await listObjectKeys(s3, bucket);
    const filesystem = await statfs(options.backupsRoot);
    const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    const requiredBytes = Math.ceil(targetObjects.reduce((sum, item) => sum + item.size, 0) * 1.1) + 100 * 1024 * 1024;
    if (freeBytes < requiredBytes) throw new Error(`Insufficient backup space for safety archive: need ${requiredBytes} bytes, have ${freeBytes}`);
    const safety = await exportProject({ prisma: options.prisma, passphrase: options.passphrase, backupsRoot: path.join(options.backupsRoot, 'safety'), name: `safety-${Date.now()}` });
    await validateArchive(safety.path, options.passphrase);
    safetyPath = safety.path;
  }

  try {
    await putArchiveObjects(archive, s3, bucket);
    await restoreDatabase(archive, options.backupsRoot);
    const stats = await databaseStats(options.prisma);
    if (canonicalJson(stats) !== canonicalJson(archive.manifest.database.tables)) throw new Error('Restored database verification failed');
    const restoredObjects = await listObjectKeys(s3, bucket);
    if (restoredObjects.length !== archive.manifest.objects.length) throw new Error('Restored object count verification failed');
    await writeFile(path.join(options.backupsRoot, 'runtime.env.imported.enc'), await readFile(path.join(options.archiveRoot, 'runtime.env.enc')), { mode: 0o600 });
    await writeFile(path.join(options.backupsRoot, '.reconcile-queue'), archive.manifest.id, { mode: 0o600 });
    return { manifest: archive.manifest, safetyPath };
  } catch (error) {
    if (safetyPath) {
      const safety = await validateArchive(safetyPath, options.passphrase);
      await putArchiveObjects(safety, s3, bucket);
      await restoreDatabase(safety, options.backupsRoot);
    } else if (options.mode === 'fresh') {
      const created = await listObjectKeys(s3, bucket);
      for (let index = 0; index < created.length; index += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: created.slice(index, index + 1000).map((item) => ({ Key: item.key })), Quiet: true } }));
      }
    }
    throw error;
  }
}

export async function decryptRuntimeConfig(archiveRoot: string, passphrase: string, target: string) {
  const archive = await validateArchive(archiveRoot, passphrase);
  await decryptFile(path.join(archiveRoot, 'runtime.env.enc'), target, archive.encryptionKey);
}

export async function listArchives(backupsRoot: string) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
  const output = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.partial') || entry.name.startsWith('.')) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(backupsRoot, entry.name, 'manifest.json'), 'utf8')) as TransferManifest;
      output.push({ id: manifest.id, createdAt: manifest.createdAt, totalRows: manifest.database.totalRows, objectCount: manifest.objects.length, objectBytes: manifest.objectBytes, schema: manifest.prismaSchemaSha256, path: path.join(backupsRoot, entry.name) });
    } catch {
      // Ignore incomplete/non-archive directories.
    }
  }
  const incoming = path.join(backupsRoot, 'incoming');
  const incomingEntries = await readdir(incoming, { withFileTypes: true }).catch(() => []);
  for (const entry of incomingEntries) {
    if (!entry.isDirectory() || entry.name.endsWith('.partial')) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(incoming, entry.name, 'manifest.json'), 'utf8')) as TransferManifest;
      output.push({ id: manifest.id, createdAt: manifest.createdAt, totalRows: manifest.database.totalRows, objectCount: manifest.objects.length, objectBytes: manifest.objectBytes, schema: manifest.prismaSchemaSha256, path: path.join(incoming, entry.name) });
    } catch { /* Ignore incomplete directories. */ }
  }
  return output.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
