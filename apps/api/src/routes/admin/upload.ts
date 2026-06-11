import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { canAccessSplat } from './permissions.js';

// Accepted source formats
const ACCEPTED_EXTENSIONS = ['.ply', '.spz', '.sog', '.meta.json', '.lod-meta.json', '.compressed.ply', '.splat', '.ksplat'];
const PREVIEW_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const PREVIEW_MAX_BYTES = (Number(process.env.MAX_PREVIEW_UPLOAD_MB) || 8) * 1024 * 1024;

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return '';
  if (parts.slice(-2).join('.') === 'meta.json') return '.meta.json';
  if (parts.slice(-2).join('.') === 'lod-meta.json') return '.lod-meta.json';
  // Check for .compressed.ply
  if (parts.slice(-2).join('.') === 'compressed.ply') return '.compressed.ply';
  return '.' + parts[parts.length - 1];
}

function getPreviewExtension(filename: string, mimetype: string): string {
  const mimeExtension = PREVIEW_MIME_TYPES.get(mimetype);
  if (mimeExtension) return mimeExtension;

  const extension = getExtension(filename);
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(extension)
    ? (extension === '.jpeg' ? '.jpg' : extension)
    : '';
}

type ImageDimensions = {
  width: number;
  height: number;
};

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  const isPng = buffer.length >= 24
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
  if (!isPng) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let marker = buffer[offset + 1];
    offset += 2;
    while (marker === 0xff && offset < buffer.length) {
      marker = buffer[offset];
      offset += 1;
    }

    if (marker === 0xda || marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > buffer.length) break;

    const length = buffer.readUInt16BE(offset);
    const segmentStart = offset + 2;
    if (length < 2 || segmentStart + length - 2 > buffer.length) break;

    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    );

    if (isStartOfFrame && segmentStart + 5 <= buffer.length) {
      return {
        height: buffer.readUInt16BE(segmentStart + 1),
        width: buffer.readUInt16BE(segmentStart + 3),
      };
    }

    offset += length;
  }

  return null;
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }

  if (chunkType === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (chunkType === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  return null;
}

function readImageDimensions(buffer: Buffer, mimetype: string): ImageDimensions | null {
  if (mimetype === 'image/png') return readPngDimensions(buffer);
  if (mimetype === 'image/jpeg') return readJpegDimensions(buffer);
  if (mimetype === 'image/webp') return readWebpDimensions(buffer);

  return readPngDimensions(buffer) || readJpegDimensions(buffer) || readWebpDimensions(buffer);
}

function isSixteenByNine({ width, height }: ImageDimensions): boolean {
  return width > 0 && height > 0 && width * 9 === height * 16;
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

  // POST /api/admin/splats/:id/preview
  app.post('/splats/:id/preview', async (request, reply) => {
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
        error: { code: 'FORBIDDEN', message: 'You cannot upload previews for this splat' },
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: { code: 'NO_FILE', message: 'No preview image provided' },
      });
    }

    const extension = getPreviewExtension(data.filename, data.mimetype);
    if (!extension || !PREVIEW_MIME_TYPES.has(data.mimetype)) {
      return reply.status(400).send({
        error: { code: 'INVALID_FORMAT', message: 'Preview must be a JPEG, PNG, or WebP image' },
      });
    }

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: { code: 'FILE_TOO_LARGE', message: 'Preview image is too large' },
      });
    }

    if (buffer.length > PREVIEW_MAX_BYTES) {
      return reply.status(413).send({
        error: { code: 'FILE_TOO_LARGE', message: `Preview exceeds ${process.env.MAX_PREVIEW_UPLOAD_MB || 8} MB limit` },
      });
    }

    const dimensions = readImageDimensions(buffer, data.mimetype);
    if (!dimensions) {
      return reply.status(400).send({
        error: { code: 'INVALID_IMAGE', message: 'Preview image dimensions could not be read' },
      });
    }

    if (!isSixteenByNine(dimensions)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ASPECT_RATIO',
          message: `Preview must be 16:9. Received ${dimensions.width}x${dimensions.height}.`,
        },
      });
    }

    const previewKey = `splats/${id}/preview/poster-${Date.now()}-${randomUUID()}${extension}`;

    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: previewKey,
        Body: buffer,
        ContentType: data.mimetype,
      }));
      app.log.info(`Uploaded preview ${previewKey} to MinIO (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      app.log.error(`Failed to upload preview to MinIO: ${err}`);
      return reply.status(500).send({
        error: { code: 'UPLOAD_FAILED', message: 'Failed to store preview image' },
      });
    }

    const updated = await prisma.splat.update({
      where: { id },
      data: { posterKey: previewKey },
      select: { posterKey: true },
    });

    return {
      preview: {
        posterKey: updated.posterKey,
        posterUrl: `${process.env.ASSET_PUBLIC_URL || '/assets'}/${updated.posterKey}`,
        width: dimensions.width,
        height: dimensions.height,
      },
    };
  });
}
