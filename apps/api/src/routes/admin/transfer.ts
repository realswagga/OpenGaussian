import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireMasterAdmin, type AuthRequest } from '../../middleware/auth.js';
import { acquireTransferBarrier, releaseTransferBarrier } from '../../transfer/barrier.js';
import { exportProject, listArchives, validateArchive } from '../../transfer/archive.js';
import { canonicalJson } from '../../transfer/utils.js';

const authorizations = new Map<string, { userId: string; expiresAt: number }>();
const jobs = new Map<string, any>();

function backupRoot() {
  return path.resolve(process.env.TRANSFER_BACKUP_DIR || '/backups');
}

function archiveRoot(id: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error('Invalid archive identifier');
  return path.join(backupRoot(), id);
}

async function requireTransferAuthorization(request: AuthRequest, reply: FastifyReply) {
  const token = request.headers['x-transfer-token'];
  const stored = typeof token === 'string' ? authorizations.get(token) : undefined;
  if (!stored || stored.userId !== request.user?.id || stored.expiresAt < Date.now()) {
    return reply.status(403).send({ error: { code: 'TRANSFER_REAUTH_REQUIRED', message: 'Project transfer reauthentication required' } });
  }
  authorizations.delete(token as string);
}

export async function adminTransferRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;
  app.addHook('onRequest', requireMasterAdmin);

  app.post('/transfer/reauth', async (request, reply) => {
    const { password } = request.body as { password?: string };
    const auth = request as AuthRequest;
    const user = await prisma.user.findUnique({ where: { id: auth.user!.id } });
    if (!password || !user || !await bcrypt.compare(password, user.passwordHash)) {
      return reply.status(403).send({ error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } });
    }
    const token = randomUUID();
    authorizations.set(token, { userId: user.id, expiresAt: Date.now() + 5 * 60_000 });
    return { token, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  });

  app.get('/transfer/archives', async () => ({ items: await listArchives(backupRoot()) }));

  app.post('/transfer/exports', { preHandler: requireTransferAuthorization as any }, async (request, reply) => {
    const { passphrase, name } = request.body as { passphrase?: string; name?: string };
    if (!passphrase || passphrase.length < 12) return reply.status(400).send({ error: { code: 'WEAK_PASSPHRASE', message: 'Use at least 12 characters' } });
    const id = name?.replace(/[^a-zA-Z0-9._-]/g, '-') || `project-${Date.now()}`;
    const initial = { id, operation: 'export', status: 'pending', phase: 'queued', objectsDone: 0, objectsTotal: 0, bytesDone: 0, bytesTotal: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    jobs.set(id, initial);
    setImmediate(async () => {
      const queue = (app as any).processingQueue;
      try {
        await acquireTransferBarrier();
        await queue.pause();
        const deadline = Date.now() + Number(process.env.TRANSFER_DRAIN_TIMEOUT_MS || 300_000);
        while (await queue.getActiveCount() > 0) {
          if (Date.now() > deadline) throw new Error('Timed out waiting for active processing jobs');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        await exportProject({ prisma, passphrase, backupsRoot: backupRoot(), name: id, onProgress: (progress) => jobs.set(id, progress) });
      } catch (error) {
        jobs.set(id, { ...jobs.get(id), status: 'failed', phase: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
      } finally {
        await queue.resume().catch(() => undefined);
        releaseTransferBarrier();
      }
    });
    return reply.status(202).send({ job: initial });
  });

  app.get('/transfer/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    let job = jobs.get(id);
    if (!job) job = await readFile(path.join(backupRoot(), '.jobs', `${id}.json`), 'utf8').then(JSON.parse).catch(() => null);
    if (!job) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Transfer job not found' } });
    return { job };
  });

  app.get('/transfer/jobs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const timer = setInterval(async () => {
      const job = jobs.get(id) ?? await readFile(path.join(backupRoot(), '.jobs', `${id}.json`), 'utf8').then(JSON.parse).catch(() => null);
      reply.raw.write(`data: ${JSON.stringify(job)}\n\n`);
      if (!job || ['completed', 'failed'].includes(job.status)) {
        clearInterval(timer);
        reply.raw.end();
      }
    }, 1000);
    request.raw.on('close', () => clearInterval(timer));
  });

  app.post('/transfer/uploads', { preHandler: requireTransferAuthorization as any }, async (request, reply) => {
    const { manifest, manifestHmac, crypto } = request.body as { manifest?: unknown; manifestHmac?: string; crypto?: unknown };
    if (!manifest || !manifestHmac || !crypto) return reply.status(400).send({ error: { code: 'INVALID_UPLOAD', message: 'Manifest, HMAC, and crypto descriptor are required' } });
    const uploadId = randomUUID();
    const root = path.join(backupRoot(), 'incoming', `${uploadId}.partial`);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, 'manifest.json'), canonicalJson(manifest), { mode: 0o600 });
    await writeFile(path.join(root, 'manifest.hmac'), manifestHmac, { mode: 0o600 });
    await writeFile(path.join(root, 'crypto.json'), JSON.stringify(crypto), { mode: 0o600 });
    return { uploadId };
  });

  app.put('/transfer/uploads/:id/files/:fileId', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const { id, fileId } = request.params as { id: string; fileId: string };
    if (!/^[a-f0-9]{64}$|^(database|runtime-config|bucket-(policy|cors|lifecycle|tags|versioning))$/.test(fileId)) return reply.status(400).send({ error: { code: 'INVALID_FILE_ID', message: 'Invalid file identifier' } });
    const root = path.join(backupRoot(), 'incoming', `${id}.partial`);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const expected = manifest.files?.find((file: any) => file.fileId === fileId);
    if (!expected) return reply.status(404).send({ error: { code: 'FILE_NOT_LISTED', message: 'File is not listed by the manifest' } });
    const target = path.join(root, ...String(expected.path).split('/'));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(request.headers['content-range'] || ''));
    if (!range || Number(range[3]) !== expected.size) return reply.status(400).send({ error: { code: 'INVALID_RANGE', message: 'Valid Content-Range required' } });
    const offset = Number(range[1]);
    const current = await stat(target).then((item) => item.size).catch(() => 0);
    if (current !== offset) return reply.status(409).send({ error: { code: 'OFFSET_MISMATCH', message: 'Resume from server offset', details: { offset: current } } });
    const buffer = request.body as Buffer;
    const handle = await open(target, current === 0 ? 'wx' : 'a', 0o600);
    try { await handle.write(buffer); } finally { await handle.close(); }
    return { offset: current + buffer.length, complete: current + buffer.length === expected.size };
  });

  app.post('/transfer/uploads/:id/finalize', { preHandler: requireTransferAuthorization as any }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { passphrase } = request.body as { passphrase?: string };
    if (!passphrase) return reply.status(400).send({ error: { code: 'PASSPHRASE_REQUIRED', message: 'Passphrase required' } });
    const partial = path.join(backupRoot(), 'incoming', `${id}.partial`);
    const archive = await validateArchive(partial, passphrase);
    const completed = path.join(backupRoot(), archive.manifest.id);
    const { rename } = await import('node:fs/promises');
    await rename(partial, completed);
    return { archive: archive.manifest.id, path: completed };
  });

  app.post('/transfer/archives/:id/validate', { preHandler: requireTransferAuthorization as any }, async (request) => {
    const { id } = request.params as { id: string };
    const { passphrase } = request.body as { passphrase: string };
    const root = archiveRoot(id);
    const result = await validateArchive(root, passphrase);
    return { valid: true, id: result.manifest.id, totalRows: result.manifest.database.totalRows, objectCount: result.manifest.objects.length, objectBytes: result.manifest.objectBytes };
  });

  app.post('/transfer/archives/:id/prepare-import', { preHandler: requireTransferAuthorization as any }, async (request) => {
    const { id } = request.params as { id: string };
    const mode = (request.body as { mode?: string }).mode === 'replace' ? 'replace' : 'fresh';
    archiveRoot(id);
    const bundle = path.join('/backups', id).replaceAll('\\', '/');
    return {
      mode,
      command: `./scripts/project-transfer.sh import ${JSON.stringify(bundle)} --mode=${mode}${mode === 'replace' ? ` --confirm=REPLACE:${id}` : ''}`,
      powershellCommand: `.\\scripts\\project-transfer.ps1 import ${JSON.stringify(bundle)} --mode=${mode}${mode === 'replace' ? ` --confirm=REPLACE:${id}` : ''}`,
    };
  });
}
