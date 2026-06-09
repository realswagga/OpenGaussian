import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { canAccessSplat } from './permissions.js';

// Accepted source formats
const ACCEPTED_EXTENSIONS = ['.ply', '.spz', '.sog', '.meta.json', '.lod-meta.json', '.compressed.ply', '.splat', '.ksplat'];

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return '';
  if (parts.slice(-2).join('.') === 'meta.json') return '.meta.json';
  if (parts.slice(-2).join('.') === 'lod-meta.json') return '.lod-meta.json';
  // Check for .compressed.ply
  if (parts.slice(-2).join('.') === 'compressed.ply') return '.compressed.ply';
  return '.' + parts[parts.length - 1];
}

// S3 client for MinIO
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
});

const S3_BUCKET = process.env.S3_BUCKET || 'gsplat-assets';

export async function adminUploadRoutes(app: FastifyInstance) {
  const prisma: PrismaClient = (app as any).prisma;

  app.addHook('onRequest', requireAdmin);

  // POST /api/admin/splats/:id/upload
  app.post('/splats/:id/upload', async (request, reply) => {
    const { id } = request.params as { id: string };

    const access = await canAccessSplat(prisma, request as AuthRequest, id, 'upload');
    const splat = access.splat;
    if (!splat) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Splat not found' },
      });
    }
    if (!access.ok) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You cannot upload files for this splat' },
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: { code: 'NO_FILE', message: 'No file provided' },
      });
    }

    const ext = getExtension(data.filename);
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_FORMAT',
          message: `Unsupported format "${ext}". Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`,
        },
      });
    }

    // Determine next version number
    const latestVersion = await prisma.splatVersion.findFirst({
      where: { splatId: id },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    // Read file buffer
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: { code: 'FILE_TOO_LARGE', message: 'File too large' },
      });
    }

    const maxBytes = (Number(process.env.MAX_UPLOAD_MB) || 2048) * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return reply.status(413).send({
        error: { code: 'FILE_TOO_LARGE', message: `File exceeds ${process.env.MAX_UPLOAD_MB || 2048} MB limit` },
      });
    }

    // Store original in MinIO
    const originalKey = `splats/${id}/originals/${nextVersion}/source${ext}`;

    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: originalKey,
        Body: buffer,
        ContentType: 'application/octet-stream',
      }));
      app.log.info(`Uploaded ${originalKey} to MinIO (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    } catch (err) {
      app.log.error(`Failed to upload to MinIO: ${err}`);
      return reply.status(500).send({
        error: { code: 'UPLOAD_FAILED', message: 'Failed to store file in object storage' },
      });
    }

    // Create version record
    const version = await prisma.splatVersion.create({
      data: {
        splatId: id,
        version: nextVersion,
        sourceKey: originalKey,
        processingStatus: 'PENDING',
        processingLog: `Uploaded: ${data.filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`,
      },
    });

    // Update splat source format
    await prisma.splat.update({
      where: { id },
      data: {
        sourceFormat: ext.replace('.', ''),
        sourceObjectKey: originalKey,
        status: 'DRAFT',
      },
    });

    // After successful upload, auto-enqueue processing
    try {
      const queue = (app as any).processingQueue;
      if (queue) {
        // Mark as processing
        await prisma.splatVersion.update({
          where: { id: version.id },
          data: { processingStatus: 'RUNNING' },
        });

        await prisma.splat.update({
          where: { id },
          data: { status: 'PROCESSING' },
        });

        // Enqueue jobs
        await queue.add('splat.validate', {
          splatId: id,
          versionId: version.id,
          sourceObjectKey: originalKey,
          jobType: 'splat.validate',
        });

        await queue.add('splat.extractMetadata', {
          splatId: id,
          versionId: version.id,
          sourceObjectKey: originalKey,
          jobType: 'splat.extractMetadata',
        });

        await queue.add('splat.convert', {
          splatId: id,
          versionId: version.id,
          sourceObjectKey: originalKey,
          jobType: 'splat.convert',
        });

        app.log.info(`Enqueued processing jobs for splat ${id} version ${nextVersion}`);
      }
    } catch (err) {
      app.log.warn(`Failed to enqueue jobs for splat ${id}: ${err}`);
      // Don't fail the upload — admin can manually trigger processing
    }

    return {
      version: {
        id: version.id,
        version: version.version,
        sourceKey: version.sourceKey,
        status: 'RUNNING',
        fileSize: buffer.length,
      },
    };
  });
}
