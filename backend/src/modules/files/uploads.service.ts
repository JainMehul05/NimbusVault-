import type { File, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@database/prisma';
import { config } from '@config/index';
import { AppError, ErrorCodes } from '@common/errors';
import { createChildLogger } from '@common/logger';
import { contentProblem } from '@common/file-signature';
import { STAGING_PREFIX, storageService } from '@common/storage';
import { fileService } from './files.service';
import { releaseQuota, reserveQuota } from './quota.service';

const log = createChildLogger({ module: 'uploads' });

export interface BeginUploadInput {
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  folderId: string | null;
  checksumSha256?: string;
  requestId?: string;
}

/**
 * Presigned (direct-to-storage) uploads.
 *
 *  1. begin    — authorize the folder, reserve quota, and create an UPLOADING row; only then issue
 *                a URL, bound to one staging object, one content type and one exact length.
 *  2. (client) — PUT the bytes to storage.
 *  3. complete — verify the stored object, copy it to its permanent key, mark it READY.
 *
 * The client can only ever write to the staging key, so re-using the URL after completion cannot
 * alter the finished file. Anything that fails verification, is aborted, or is never completed
 * has its object removed and its quota refunded, exactly once.
 */
export class UploadService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async begin(input: BeginUploadInput) {
    const { userId, contentType, sizeBytes } = input;
    const mimeType = fileService.normalizeMimeType(contentType, input.filename);
    const category = await fileService.validateFileType(mimeType, input.filename);
    const target = await fileService.resolveUploadTarget(userId, input.folderId);

    const stagingKey = `${STAGING_PREFIX}${userId}/${randomUUID()}`;
    const expiresIn = config.storage.uploadUrlTtlSeconds;

    const file = await this.prismaClient.$transaction(async (tx) => {
      await reserveQuota(tx, target.ownerId, BigInt(sizeBytes), input.requestId);
      return fileService.insertWithFreeName(tx, {
        filename: input.filename,
        sizeBytes: BigInt(sizeBytes),
        mimeType,
        category,
        ownerId: target.ownerId,
        folderId: target.folderId,
        s3Key: storageService.generateObjectKey(target.ownerId, input.filename),
        checksumSha256: input.checksumSha256?.toLowerCase() ?? null,
        status: 'UPLOADING',
        stagingKey,
        // Grace beyond the URL's own lifetime: a PUT that started in time may still be running.
        uploadExpiresAt: new Date(Date.now() + (expiresIn + 600) * 1000),
      });
    });

    try {
      const { url } = await storageService.generatePresignedUploadUrl(stagingKey, mimeType, sizeBytes, expiresIn);
      return { file, key: stagingKey, url, expiresIn, headers: { 'Content-Type': mimeType } };
    } catch (error) {
      await this.discard(file);
      throw error;
    }
  }

  /** The caller's own in-progress upload. Everyone else sees 404. */
  private async findOwn(fileId: string, userId: string): Promise<File> {
    const file = await this.prismaClient.file.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw AppError.notFound('Upload not found', ErrorCodes.FILE_NOT_FOUND);
    if (file.stagingKey ? !file.stagingKey.startsWith(`${STAGING_PREFIX}${userId}/`) : file.ownerId !== userId) {
      throw AppError.notFound('Upload not found', ErrorCodes.FILE_NOT_FOUND);
    }
    return file;
  }

  async complete(fileId: string, userId: string): Promise<{ file: File; alreadyComplete: boolean }> {
    const file = await this.findOwn(fileId, userId);
    if (file.status === 'READY') return { file, alreadyComplete: true };
    if (!file.stagingKey || (file.uploadExpiresAt && file.uploadExpiresAt < new Date())) {
      throw new AppError('This upload has expired. Start a new one.', 410, ErrorCodes.UPLOAD_EXPIRED);
    }
    // Access to the folder may have been revoked since the upload began.
    await fileService.resolveUploadTarget(userId, file.folderId);

    const meta = await this.headStaging(file);
    const fail = async (message: string, code: string, details?: unknown): Promise<never> => {
      await this.discard(file);
      throw AppError.badRequest(message, code, details);
    };

    if (BigInt(meta.size) !== file.sizeBytes) {
      return fail('The uploaded file is not the size that was declared', ErrorCodes.UPLOAD_MISMATCH, {
        declared: file.sizeBytes.toString(),
        received: meta.size,
      });
    }

    // From here on only our own immutable copy is trusted, never the client-writable object.
    await storageService.copy(file.stagingKey, file.s3Key, { ifMatch: meta.etag, contentType: file.mimeType });
    let inspected;
    try {
      inspected = await storageService.inspect(file.s3Key);
    } catch (error) {
      await storageService.delete(file.s3Key).catch(() => {});
      throw error;
    }
    const problem = contentProblem(inspected.head, file.mimeType);
    if (problem) return fail(problem, ErrorCodes.UNSUPPORTED_TYPE, { mimeType: file.mimeType });
    if (file.checksumSha256 && file.checksumSha256 !== inspected.checksumSha256) {
      return fail('The uploaded file does not match its checksum', ErrorCodes.UPLOAD_MISMATCH);
    }

    const { count } = await this.prismaClient.file.updateMany({
      where: { id: file.id, status: 'UPLOADING', deletedAt: null },
      data: { status: 'READY', checksumSha256: inspected.checksumSha256, stagingKey: null, uploadExpiresAt: null, uploadedAt: new Date() },
    });
    const current = await this.prismaClient.file.findUnique({ where: { id: file.id } });
    if (count === 0) {
      if (current?.status === 'READY' && !current.deletedAt) return { file: current, alreadyComplete: true };
      // Aborted or swept while we were verifying; do not leave the copy behind.
      await storageService.delete(file.s3Key).catch(() => {});
      throw new AppError('This upload was cancelled', 410, ErrorCodes.UPLOAD_EXPIRED);
    }

    // Only after the row is READY, so a concurrent completion never sees a missing object.
    await storageService.delete(file.stagingKey).catch((err) => {
      log.warn({ err: (err as Error).message, fileId }, 'Could not remove staging object; the lifecycle rule will');
    });
    return { file: current!, alreadyComplete: false };
  }

  private async headStaging(file: File) {
    try {
      return await storageService.getMetadata(file.stagingKey!);
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCodes.S3_OBJECT_MISSING) {
        // Not a failure: the client may still be uploading.
        throw AppError.conflict('The file has not been uploaded yet', ErrorCodes.UPLOAD_INCOMPLETE);
      }
      throw error;
    }
  }

  async abort(fileId: string, userId: string): Promise<void> {
    const file = await this.findOwn(fileId, userId);
    if (file.status !== 'UPLOADING') {
      throw AppError.conflict('This upload is already complete', ErrorCodes.ALREADY_FINALIZED);
    }
    await this.discard(file);
  }

  /** Removes an unfinished upload and refunds it. Safe to call concurrently: only one call refunds. */
  async discard(file: Pick<File, 'id' | 'ownerId' | 'sizeBytes' | 's3Key' | 'stagingKey'>): Promise<boolean> {
    const removed = await this.prismaClient.$transaction(async (tx) => {
      const { count } = await tx.file.deleteMany({ where: { id: file.id, status: 'UPLOADING' } });
      if (count === 0) return false;
      await releaseQuota(tx, file.ownerId, file.sizeBytes);
      return true;
    });
    if (removed) {
      for (const key of [file.stagingKey, file.s3Key]) {
        if (key) await storageService.delete(key).catch(() => {});
      }
    }
    return removed;
  }

  /** Discards reservations whose deadline passed (and rows stranded before deadlines existed). */
  async sweepExpired(limit = 100): Promise<number> {
    const expired = await this.prismaClient.file.findMany({
      where: {
        status: 'UPLOADING',
        OR: [
          { uploadExpiresAt: { lt: new Date() } },
          { uploadExpiresAt: null, uploadedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
        ],
      },
      take: limit,
    });
    let swept = 0;
    for (const file of expired) {
      if (await this.discard(file)) swept++;
    }
    if (swept) log.info({ swept }, 'Discarded expired uploads');
    return swept;
  }
}

export const uploadService = new UploadService();
