import type { AiJob, File, PrismaClient } from '@prisma/client';
import type { Readable } from 'stream';
import prisma from '@database/prisma';
import { config } from '@config/index';
import { intelligence, intelligenceEnabled } from '@common/intelligence';
import { createChildLogger } from '@common/logger';
import { storageService } from '@common/storage';
import { AppError, ErrorCodes } from '@common/errors';
import { chunkText } from './chunking';
import { extractDocument, ExtractionError, isAiSupportedMimeType } from './extraction';
import { AiProviderError, getEmbeddingProvider, getGenerationProvider } from './providers';
import { vectorStore } from './vector-store';
import { summaryService } from './summary.service';

const log = createChildLogger({ module: 'ai-indexing' });

const EMBED_BATCH = 32;
const MAX_ERROR_LEN = 300;

export type JobOutcome = 'succeeded' | 'retry' | 'failed' | 'cancelled' | 'unsupported';

/** Reads an object fully, aborting once it exceeds `maxBytes`. */
async function readObject(key: string, maxBytes: number): Promise<Buffer> {
  const { stream } = await storageService.download(key);
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as Readable) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      (stream as Readable).destroy();
      throw new ExtractionError('FILE_TOO_LARGE', 'File exceeds the AI processing limit');
    }
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

const clip = (msg: string) => (msg.length > MAX_ERROR_LEN ? `${msg.slice(0, MAX_ERROR_LEN)}…` : msg);

export class AiIndexingService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  isEnabled(): boolean {
    return intelligenceEnabled() || !!getEmbeddingProvider();
  }

  /**
   * Called after a successful upload. Queues supported documents when AI is configured, marks
   * unsupported types immediately, and otherwise leaves the file untouched. Returns the new status.
   */
  async onFileUploaded(file: File): Promise<File['aiStatus']> {
    if (!this.isEnabled()) return file.aiStatus;
    if (!isAiSupportedMimeType(file.mimeType)) {
      await this.prismaClient.file.update({ where: { id: file.id }, data: { aiStatus: 'UNSUPPORTED' } });
      return 'UNSUPPORTED';
    }
    await this.enqueue(file.id);
    return 'PENDING';
  }

  /**
   * Queues (re)indexing. Idempotent and race-safe: each call bumps the file's index generation
   * under a row lock and cancels older queued jobs; a running job from an older generation
   * notices it is stale and discards its results.
   */
  async enqueue(fileId: string): Promise<{ jobId: string; generation: number }> {
    if (!this.isEnabled()) {
      throw AppError.serviceUnavailable('AI indexing is not configured on this server', ErrorCodes.AI_PROVIDER_UNAVAILABLE);
    }
    const file = await this.prismaClient.file.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    if (!isAiSupportedMimeType(file.mimeType)) {
      await this.prismaClient.file.update({ where: { id: fileId }, data: { aiStatus: 'UNSUPPORTED' } });
      throw AppError.badRequest('This file type cannot be indexed', ErrorCodes.UNSUPPORTED_TYPE, { mimeType: file.mimeType });
    }

    return this.prismaClient.$transaction(async (tx) => {
      const index = await tx.documentIndex.upsert({
        where: { fileId },
        create: { fileId, generation: 1 },
        update: { generation: { increment: 1 }, errorCode: null, errorMessage: null },
      });
      await tx.aiJob.updateMany({
        where: { fileId, status: 'QUEUED' },
        data: { status: 'CANCELLED', completedAt: new Date(), lastError: 'Superseded by a newer request' },
      });
      const job = await tx.aiJob.create({
        data: { fileId, generation: index.generation, maxAttempts: config.ai.worker.maxAttempts },
      });
      await tx.file.update({ where: { id: fileId }, data: { aiStatus: 'PENDING' } });
      return { jobId: job.id, generation: index.generation };
    });
  }

  /**
   * Removes everything AI-derived for deleted files (extracted text, summary, chunks, vectors)
   * and cancels their jobs, so they vanish from search and Q&A immediately.
   */
  async purgeFiles(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    try {
      await this.prismaClient.$transaction(async (tx) => {
        await tx.aiJob.updateMany({
          where: { fileId: { in: fileIds }, status: { in: ['QUEUED', 'RUNNING'] } },
          data: { status: 'CANCELLED', completedAt: new Date(), lastError: 'File deleted' },
        });
        await vectorStore.deleteForFiles(tx, fileIds);
        await tx.documentIndex.deleteMany({ where: { fileId: { in: fileIds } } });
        await tx.file.updateMany({ where: { id: { in: fileIds } }, data: { aiStatus: 'NA' } });
      });
    } catch (err) {
      // Search already excludes deleted files, so a failed purge cannot leak content; log and move on.
      log.error({ err: (err as Error).message, count: fileIds.length }, 'Failed to purge AI data for deleted files');
    }
  }

  /** Atomically claims the next runnable job (safe across processes via SKIP LOCKED). */
  async claimNextJob(workerId: string): Promise<AiJob | null> {
    const rows = await this.prismaClient.$queryRaw<AiJob[]>`
      UPDATE "ai_jobs" SET "status" = 'RUNNING'::"AiJobStatus", "attempts" = "attempts" + 1,
        "lockedAt" = (NOW() AT TIME ZONE 'UTC'), "lockedBy" = ${workerId}, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      WHERE "id" = (
        SELECT "id" FROM "ai_jobs"
        WHERE "status" = 'QUEUED'::"AiJobStatus" AND "runAfter" <= (NOW() AT TIME ZONE 'UTC')
        ORDER BY "runAfter", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *`;
    return rows[0] ?? null;
  }

  /** Extends a running job's lock so a long document is not mistaken for a crashed worker. */
  async renewLock(job: Pick<AiJob, 'id' | 'lockedBy'>): Promise<void> {
    await this.prismaClient.aiJob.updateMany({
      where: { id: job.id, status: 'RUNNING', lockedBy: job.lockedBy },
      data: { lockedAt: new Date() },
    });
  }

  /**
   * Returns jobs orphaned by a crashed/restarted worker to the queue. A job that has already
   * used every attempt is failed instead, so a document that crashes the worker cannot do so forever.
   */
  async recoverStaleJobs(staleMs = config.ai.worker.staleLockMs): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs);
    const exhausted = await this.prismaClient.$queryRaw<AiJob[]>`
      SELECT * FROM "ai_jobs" WHERE "status" = 'RUNNING'::"AiJobStatus"
        AND "lockedAt" < ${cutoff.toISOString()}::timestamp AND "attempts" >= "maxAttempts" LIMIT 100`;
    for (const job of exhausted) {
      const message = 'Processing was interrupted repeatedly';
      await this.finishJob(job, 'FAILED', message);
      await this.markFileFailed(job, 'FAILED', 'INTERNAL_ERROR', message);
      log.error({ jobId: job.id, fileId: job.fileId, event: 'ai_job_failed' }, 'AI job abandoned after repeated crashes');
    }
    const { count } = await this.prismaClient.aiJob.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
      data: { status: 'QUEUED', lockedAt: null, lockedBy: null, runAfter: new Date() },
    });
    if (count) log.warn({ count }, 'Re-queued stale AI jobs');
    return count;
  }

  private async isCurrent(fileId: string, generation: number): Promise<boolean> {
    const [index, file] = await Promise.all([
      this.prismaClient.documentIndex.findUnique({ where: { fileId }, select: { generation: true } }),
      this.prismaClient.file.findUnique({ where: { id: fileId }, select: { deletedAt: true } }),
    ]);
    return !!index && index.generation === generation && !!file && !file.deletedAt;
  }

  private async finishJob(job: AiJob, status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED', lastError?: string) {
    await this.prismaClient.aiJob.update({
      where: { id: job.id },
      data: { status, completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: lastError ? clip(lastError) : null },
    });
  }

  /** Records a terminal failure for the current generation only. */
  private async markFileFailed(job: AiJob, aiStatus: 'FAILED' | 'UNSUPPORTED', code: string, message: string) {
    await this.prismaClient.$transaction(async (tx) => {
      const index = await tx.documentIndex.findUnique({ where: { fileId: job.fileId } });
      if (!index || index.generation !== job.generation) return;
      await vectorStore.deleteForFiles(tx, [job.fileId]);
      await tx.documentIndex.update({
        where: { fileId: job.fileId },
        data: {
          errorCode: code,
          errorMessage: clip(message),
          textContent: null,
          textLength: null,
          chunkCount: 0,
          summary: null,
          summaryStatus: 'NONE',
          indexedAt: null,
        },
      });
      await tx.file.update({ where: { id: job.fileId }, data: { aiStatus } });
    });
  }

  /**
   * Runs one claimed job end to end: download → extract → chunk → embed → atomically swap in
   * the new chunks → (optionally) summarize. Never throws; returns the outcome.
   */
  async processJob(job: AiJob): Promise<JobOutcome> {
    const started = Date.now();
    const jobLog = log.child({ jobId: job.id, fileId: job.fileId, generation: job.generation, attempt: job.attempts });

    try {
      if (!(await this.isCurrent(job.fileId, job.generation))) {
        await this.finishJob(job, 'CANCELLED', 'Superseded or file deleted');
        return 'cancelled';
      }

      const embedder = getEmbeddingProvider();
      if (intelligenceEnabled()) {
        const file = await this.prismaClient.file.findUniqueOrThrow({where:{id:job.fileId}});
        const bytes = await readObject(file.s3Key,config.ai.limits.maxFileBytes);
        const result = await intelligence<{chunkCount:number;text:string;model:string}>('/index',{file_id:file.id,filename:file.filename,object_key:file.s3Key,sha256:file.checksumSha256,mime:file.mimeType,content:bytes.toString('base64')});
        const committed=await this.prismaClient.$transaction(async tx=>{
          await tx.$queryRaw`SELECT "generation" FROM "document_indexes" WHERE "fileId"=${file.id} FOR UPDATE`;
          const index=await tx.documentIndex.findUnique({where:{fileId:file.id}});
          const current=await tx.file.findUnique({where:{id:file.id}});
          if(index?.generation!==job.generation||!current||current.deletedAt) return false;
          await tx.documentIndex.update({where:{fileId:file.id},data:{textContent:result.text,textLength:result.text.length,chunkCount:result.chunkCount,embeddingModel:result.model,embeddingDim:384,sourceChecksum:file.checksumSha256,indexedAt:new Date(),extractor:'CloudVault canonical local extraction',errorCode:null,errorMessage:null}});
          await tx.file.update({where:{id:file.id},data:{aiStatus:'INDEXED'}});
          return true;
        });
        await this.finishJob(job,committed?'SUCCEEDED':'CANCELLED');
        return committed?'succeeded':'cancelled';
      }
      if (!embedder) {
        await this.finishJob(job, 'FAILED', 'AI embeddings are not configured');
        await this.markFileFailed(job, 'FAILED', 'AI_PROVIDER_UNAVAILABLE', 'AI embeddings are not configured on this server');
        return 'failed';
      }

      const file = await this.prismaClient.file.findUniqueOrThrow({ where: { id: job.fileId } });
      await this.prismaClient.file.updateMany({ where: { id: file.id, aiStatus: { in: ['PENDING', 'FAILED', 'PROCESSING'] } }, data: { aiStatus: 'PROCESSING' } });

      const limits = {
        maxBytes: config.ai.limits.maxFileBytes,
        maxChars: config.ai.limits.maxExtractedChars,
        maxPdfPages: config.ai.limits.maxPdfPages,
        maxUncompressedBytes: config.ai.limits.maxUncompressedBytes,
        ocr: config.ai.ocr,
      };
      if (file.sizeBytes > BigInt(limits.maxBytes)) {
        throw new ExtractionError('FILE_TOO_LARGE', `File exceeds the ${Math.round(limits.maxBytes / 1048576)} MB AI processing limit`);
      }

      const buffer = await readObject(file.s3Key, limits.maxBytes);
      const extracted = await extractDocument(buffer, file.mimeType, limits);
      await this.renewLock(job);
      const chunks = chunkText(extracted.text, { size: config.ai.limits.chunkChars, overlap: config.ai.limits.chunkOverlap }, extracted.pages);

      const vectors: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        // Bail out early if the file was deleted or re-queued while we were working.
        if (i > 0) {
          if (!(await this.isCurrent(job.fileId, job.generation))) {
            await this.finishJob(job, 'CANCELLED', 'Superseded or file deleted');
            return 'cancelled';
          }
          await this.renewLock(job);
        }
        vectors.push(...(await embedder.embed(chunks.slice(i, i + EMBED_BATCH).map((c) => c.content))));
      }

      // Atomic swap: only the current generation may write, under a row lock.
      const committed = await this.prismaClient.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ generation: number }>>`
            SELECT "generation" FROM "document_indexes" WHERE "fileId" = ${job.fileId} FOR UPDATE`;
          const current = await tx.file.findUnique({ where: { id: job.fileId }, select: { deletedAt: true } });
          if (!locked[0] || locked[0].generation !== job.generation || !current || current.deletedAt) return false;

          await vectorStore.deleteForFiles(tx, [job.fileId]);
          await vectorStore.insertChunks(tx, job.fileId, job.generation, embedder.modelId, chunks, vectors);
          await tx.documentIndex.update({
            where: { fileId: job.fileId },
            data: {
              extractor: extracted.extractor,
              textContent: extracted.text,
              textLength: extracted.text.length,
              textTruncated: extracted.truncated,
              pageCount: extracted.pageCount,
              sourceChecksum: file.checksumSha256,
              embeddingModel: embedder.modelId,
              embeddingDim: embedder.dimensions,
              chunkCount: chunks.length,
              errorCode: null,
              errorMessage: null,
              summary: null,
              summaryStatus: 'NONE',
              summaryModel: null,
              summaryCoverage: null,
              summaryError: null,
              summaryGeneratedAt: null,
              indexedAt: new Date(),
            },
          });
          await tx.file.update({ where: { id: job.fileId }, data: { aiStatus: 'INDEXED' } });
          return true;
        },
        { timeout: 60_000 }
      );

      if (!committed) {
        await this.finishJob(job, 'CANCELLED', 'Superseded or file deleted');
        return 'cancelled';
      }

      await this.finishJob(job, 'SUCCEEDED');
      jobLog.info({ chunks: chunks.length, chars: extracted.text.length, ms: Date.now() - started }, 'Document indexed');

      // Summary is best-effort and recorded separately; it never fails indexing.
      if (config.ai.generation.autoSummarize && getGenerationProvider()) {
        await summaryService.generate(job.fileId, job.generation).catch((err) => {
          jobLog.warn({ err: (err as Error).message }, 'Automatic summary failed');
        });
      }
      return 'succeeded';
    } catch (err) {
      if (err instanceof ExtractionError) {
        jobLog.info({ code: err.code }, 'Document not indexable');
        await this.finishJob(job, 'FAILED', `${err.code}: ${err.message}`);
        await this.markFileFailed(job, err.unsupported ? 'UNSUPPORTED' : 'FAILED', err.code, err.message);
        return err.unsupported ? 'unsupported' : 'failed';
      }

      const retryable = err instanceof AiProviderError ? err.retryable : true;
      const message = err instanceof AiProviderError ? err.message : 'Unexpected indexing error';
      if (!(err instanceof AiProviderError)) jobLog.error({ err: (err as Error).message }, 'Indexing error');

      if (retryable && job.attempts < job.maxAttempts) {
        const delayMs = Math.min(15_000 * 2 ** (job.attempts - 1), 10 * 60_000);
        await this.prismaClient.aiJob.update({
          where: { id: job.id },
          data: { status: 'QUEUED', lockedAt: null, lockedBy: null, lastError: clip(message), runAfter: new Date(Date.now() + delayMs) },
        });
        await this.prismaClient.file.updateMany({ where: { id: job.fileId, aiStatus: 'PROCESSING' }, data: { aiStatus: 'PENDING' } });
        jobLog.warn({ delayMs, message }, 'Indexing failed; will retry');
        return 'retry';
      }

      await this.finishJob(job, 'FAILED', message);
      await this.markFileFailed(job, 'FAILED', err instanceof AiProviderError ? 'AI_PROVIDER_ERROR' : 'INTERNAL_ERROR', message);
      jobLog.error({ message, event: 'ai_job_failed' }, 'Indexing failed permanently');
      return 'failed';
    }
  }

  /** Processes runnable jobs until the queue is empty (used by tests and the worker). */
  async drain(workerId = 'drain', maxJobs = 100): Promise<JobOutcome[]> {
    const outcomes: JobOutcome[] = [];
    for (let i = 0; i < maxJobs; i++) {
      const job = await this.claimNextJob(workerId);
      if (!job) break;
      outcomes.push(await this.processJob(job));
    }
    return outcomes;
  }
}

export const aiIndexingService = new AiIndexingService();
