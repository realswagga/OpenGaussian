import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

type ProcessingQueueResult =
  | { status: 'RUNNING' }
  | { status: 'FAILED'; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendLog(existing: string | null, message: string): string {
  return existing ? `${existing}\n${message}` : message;
}

/** Queue one sequential worker job so required processing stages cannot race. */
export async function enqueueSplatProcessing(
  app: FastifyInstance,
  prisma: PrismaClient,
  input: { splatId: string; versionId: string; sourceObjectKey: string },
): Promise<ProcessingQueueResult> {
  const [splat, version] = await Promise.all([
    prisma.splat.findUnique({
      where: { id: input.splatId },
      select: { status: true, servingVersionId: true },
    }),
    prisma.splatVersion.findUnique({
      where: { id: input.versionId },
      select: { processingStatus: true, processingLog: true },
    }),
  ]);

  if (!splat || !version) {
    return { status: 'FAILED', error: 'Splat version no longer exists' };
  }

  const queuedLog = version.processingStatus === 'FAILED'
    ? `Processing retry queued at ${new Date().toISOString()}`
    : appendLog(version.processingLog, `Processing queued at ${new Date().toISOString()}`);

  await prisma.$transaction([
    prisma.splatVersion.update({
      where: { id: input.versionId },
      data: { processingStatus: 'RUNNING', processingLog: queuedLog },
    }),
    prisma.splat.update({
      where: { id: input.splatId },
      data: { status: splat.status === 'PUBLISHED' ? 'PUBLISHED' : 'PROCESSING' },
    }),
  ]);

  try {
    const queue = (app as FastifyInstance & {
      processingQueue?: { add: (...args: any[]) => Promise<unknown> };
    }).processingQueue;
    if (!queue) throw new Error('Processing queue is unavailable');

    await queue.add('splat.process', {
      splatId: input.splatId,
      versionId: input.versionId,
      sourceObjectKey: input.sourceObjectKey,
      jobType: 'splat.convert',
    }, {
      jobId: `process-${input.versionId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    });

    return { status: 'RUNNING' };
  } catch (error) {
    const message = errorMessage(error);
    const restoredStatus = splat.status === 'PUBLISHED'
      ? 'PUBLISHED'
      : splat.servingVersionId
        ? 'READY'
        : 'FAILED';

    await prisma.$transaction([
      prisma.splatVersion.update({
        where: { id: input.versionId },
        data: {
          processingStatus: 'FAILED',
          processingLog: appendLog(queuedLog, `STAGE queue FAILED: ${message}`),
        },
      }),
      prisma.splat.update({
        where: { id: input.splatId },
        data: { status: restoredStatus },
      }),
    ]);

    app.log.error(`Failed to enqueue processing for splat ${input.splatId}: ${message}`);
    return { status: 'FAILED', error: message };
  }
}
