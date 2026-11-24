import type { PrismaClient, File } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { storageService } from '@common/storage';
import { logger, createRequestLogger } from '@common/logger';
import { authorizationService } from '@common/authorization';

export interface CreateFileInput {
  filename: string;
  sizeBytes: bigint;
  mimeType: string;
  category: 'pdf' | 'image' | 'video' | 'document' | 'other';
  ownerId: string;
  folderId: string | null;
  s3Key: string;
  checksumSha256: string;
  status: 'UPLOADING' | 'READY' | 'FAILED';
}

export interface FileListResult {
  files: Array<{
    id: string;
    filename: string;
    sizeBytes: bigint;
    mimeType: string;
    category: string;
    folderId: string | null;
    status: string;
    uploadedAt: Date;
    deletedAt: Date | null;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SafeFile {
  id: string;
  filename: string;
  sizeBytes: string; // BigInt serialized as string
  mimeType: string;
  category: string;
  folderId: string | null;
  status: string;
  uploadedAt: Date;
  deletedAt: Date | null;
}

export class FileService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  getPrismaClient(): PrismaClient {
    return this.prismaClient;
  }

  private toSafeFile(file: File): SafeFile {
    return {
      id: file.id,
      filename: file.filename,
      sizeBytes: file.sizeBytes.toString(),
      mimeType: file.mimeType,
      category: file.category,
      folderId: file.folderId,
      status: file.status,
      uploadedAt: file.uploadedAt,
      deletedAt: file.deletedAt,
    };
  }

  async getCategoryFromMimeType(mimeType: string): Promise<'pdf' | 'image' | 'video' | 'document' | 'other'> {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown' ||
      mimeType === 'application/rtf' ||
      mimeType === 'application/msword' ||
      mimeType.includes('vnd.ms-') ||
      mimeType.includes('vnd.openxmlformats')
    ) {
      return 'document';
    }
    return 'other';
  }

  /**
   * Browsers often send Markdown (and sometimes other files) as an empty or generic MIME type.
   * Resolve a canonical type from the extension for those cases only.
   */
  normalizeMimeType(mimeType: string, filename: string): string {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    const generic = !mimeType || mimeType === 'application/octet-stream' || mimeType === 'text/x-markdown';
    if (ext === 'md' || ext === 'markdown') {
      if (generic || mimeType === 'text/plain' || mimeType === 'text/markdown') return 'text/markdown';
    }
    if (generic) {
      const byExt: Record<string, string> = {
        pdf: 'application/pdf',
        txt: 'text/plain',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      if (byExt[ext]) return byExt[ext];
    }
    return mimeType;
  }

  async validateFileType(mimeType: string, _filename: string): Promise<'pdf' | 'image' | 'video' | 'document' | 'other'> {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/markdown',
      'application/rtf',
    ];

    if (!allowedTypes.includes(mimeType)) {
      throw AppError.badRequest('Unsupported file type', ErrorCodes.UNSUPPORTED_TYPE, { mimeType });
    }

    return this.getCategoryFromMimeType(mimeType);
  }

  async reserveQuota(userId: string, sizeBytes: bigint, requestId?: string): Promise<void> {
    const log = requestId ? createRequestLogger(requestId) : logger;

    // Single conditional UPDATE: the check and the increment are atomic, so concurrent
    // uploads cannot together exceed the quota.
    const updated = await this.prismaClient.$executeRaw`
      UPDATE "users" SET "storageUsedBytes" = "storageUsedBytes" + ${sizeBytes}
      WHERE "id" = ${userId} AND "storageUsedBytes" + ${sizeBytes} <= "storageQuotaBytes"`;

    if (updated === 0) {
      const user = await this.prismaClient.user.findUnique({
        where: { id: userId },
        select: { storageQuotaBytes: true, storageUsedBytes: true },
      });
      if (!user) {
        throw AppError.notFound('User not found', ErrorCodes.NOT_OWNER);
      }
      log.warn({ userId, requested: sizeBytes.toString(), quota: user.storageQuotaBytes.toString(), used: user.storageUsedBytes.toString() }, 'Quota exceeded');
      throw AppError.forbidden('Storage quota exceeded', ErrorCodes.QUOTA_EXCEEDED, {
        quota: user.storageQuotaBytes.toString(),
        used: user.storageUsedBytes.toString(),
        requested: sizeBytes.toString(),
      });
    }
  }

  async releaseQuota(userId: string, sizeBytes: bigint): Promise<void> {
    await this.prismaClient.user.update({
      where: { id: userId },
      data: {
        storageUsedBytes: {
          decrement: sizeBytes,
        },
      },
    });
  }

  async validateFolderOwnership(folderId: string, userId: string): Promise<{ id: string } | null> {
    return this.prismaClient.folder.findFirst({
      where: {
        id: folderId,
        ownerId: userId,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  async createUploadRecord(input: CreateFileInput): Promise<File> {
    return this.prismaClient.file.create({
      data: {
        filename: input.filename,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        category: input.category,
        ownerId: input.ownerId,
        folderId: input.folderId,
        s3Key: input.s3Key,
        checksumSha256: input.checksumSha256,
        status: input.status,
      },
    });
  }

  async finalizeUpload(fileId: string, status: 'READY' | 'FAILED' = 'READY'): Promise<File> {
    return this.prismaClient.file.update({
      where: { id: fileId },
      data: { status },
    });
  }

  async findById(fileId: string, userId: string): Promise<File | null> {
    try {
      const access = await authorizationService.authorizeFileAccess(
        { userId, isAuthenticated: true },
        fileId,
        'read'
      );
      return access.file ?? null;
    } catch {
      return null;
    }
  }

  async findByIdAnyStatus(fileId: string, userId: string): Promise<File | null> {
    try {
      const access = await authorizationService.getFileAccess(userId, fileId);
      return access.file ?? null;
    } catch {
      return null;
    }
  }

  async listFiles(
    userId: string,
    options: {
      folderId?: string | null;
      category?: string;
      status?: string;
      search?: string;
      page: number;
      limit: number;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
    }
  ): Promise<FileListResult> {
    const { folderId, category, status, search, page, limit, sortBy, sortOrder } = options;

    const where: any = {
      ownerId: userId,
      deletedAt: null,
    };

    if (folderId !== undefined) {
      where.folderId = folderId;
    }

    if (category) {
      where.category = category;
    }

    if (status) {
      where.status = status;
    }

    if (search) {
      where.filename = { contains: search, mode: 'insensitive' };
    }

    const validSortFields = ['filename', 'sizeBytes', 'uploadedAt', 'category'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'uploadedAt';

    const [files, total] = await Promise.all([
      this.prismaClient.file.findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          filename: true,
          sizeBytes: true,
          mimeType: true,
          category: true,
          folderId: true,
          status: true,
          aiStatus: true,
          uploadedAt: true,
          deletedAt: true,
        },
      }),
      this.prismaClient.file.count({ where }),
    ]);

    return {
      files,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async rename(fileId: string, userId: string, newFilename: string): Promise<{ file: File; oldFilename: string }> {
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'rename');
    const file = access.file!;

    const existingFile = await this.prismaClient.file.findFirst({
      where: {
        ownerId: file.ownerId,
        folderId: file.folderId,
        filename: newFilename,
        deletedAt: null,
        NOT: { id: fileId },
      },
    });

    if (existingFile) {
      throw AppError.conflict('A file with this name already exists in the folder', ErrorCodes.NAME_CONFLICT);
    }

    const updatedFile = await this.prismaClient.file.update({
      where: { id: fileId },
      data: { filename: newFilename },
    });

    return { file: updatedFile, oldFilename: file.filename };
  }

  /**
   * Moves a file. Requires `move` on the file. The destination must belong to the file's owner
   * (files never change owner by moving), and a non-owner must also be able to write there.
   */
  async move(fileId: string, userId: string, newFolderId: string | null): Promise<{ file: File; previousFolderId: string | null }> {
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'move');
    const file = access.file!;

    if (newFolderId === null) {
      if (!access.isOwner) {
        throw AppError.forbidden('Only the owner can move a file to the top level', ErrorCodes.FORBIDDEN);
      }
    } else {
      const folder = await this.prismaClient.folder.findFirst({
        where: { id: newFolderId, ownerId: file.ownerId, deletedAt: null },
      });
      if (!folder) {
        throw AppError.notFound('Destination folder not found', ErrorCodes.FOLDER_NOT_FOUND);
      }
      if (!access.isOwner) {
        await authorizationService.authorizeFolderAccess({ userId, isAuthenticated: true }, newFolderId, 'write');
      }
    }

    if (newFolderId !== file.folderId) {
      const existingFile = await this.prismaClient.file.findFirst({
        where: { ownerId: file.ownerId, folderId: newFolderId, filename: file.filename, deletedAt: null, NOT: { id: fileId } },
      });
      if (existingFile) {
        throw AppError.conflict('A file with this name already exists in the destination folder', ErrorCodes.NAME_CONFLICT);
      }
    }

    const updatedFile = await this.prismaClient.file.update({
      where: { id: fileId },
      data: { folderId: newFolderId },
    });

    return { file: updatedFile, previousFolderId: file.folderId };
  }

  /** Soft-deletes a file (owner only) and returns its storage to the owner's quota. */
  async softDelete(fileId: string, userId: string): Promise<File> {
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'delete');
    const file = access.file!;

    const deletedFile = await this.prismaClient.$transaction(async (tx) => {
      // Conditional update makes concurrent deletes idempotent: only one releases quota.
      const { count } = await tx.file.updateMany({ where: { id: fileId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) {
        throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
      }
      await tx.user.update({ where: { id: file.ownerId }, data: { storageUsedBytes: { decrement: file.sizeBytes } } });
      return tx.file.findUniqueOrThrow({ where: { id: fileId } });
    });

    return deletedFile;
  }

  async permanentDelete(fileId: string, userId: string): Promise<void> {
    const file = await this.findByIdAnyStatus(fileId, userId);
    if (!file) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    // Delete from storage
    try {
      await storageService.delete(file.s3Key);
    } catch (error) {
      logger.error({ err: error, s3Key: file.s3Key }, 'Failed to delete file from storage');
      // Continue with DB deletion even if storage deletion fails
    }

    await this.prismaClient.file.delete({
      where: { id: fileId },
    });
  }

  async getFileForDownload(fileId: string, userId: string): Promise<File> {
    const file = await this.findById(fileId, userId);
    if (!file) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    if (file.status !== 'READY') {
      throw AppError.badRequest('File is not ready for download', ErrorCodes.ALREADY_FINALIZED, { status: file.status });
    }

    return file;
  }

  async getStorageInfo(userId: string): Promise<{ quota: string; used: string; remaining: string }> {
    const user = await this.prismaClient.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true, storageUsedBytes: true },
    });

    if (!user) {
      throw AppError.notFound('User not found', ErrorCodes.NOT_OWNER);
    }

    const remaining = user.storageQuotaBytes - user.storageUsedBytes;

    return {
      quota: user.storageQuotaBytes.toString(),
      used: user.storageUsedBytes.toString(),
      remaining: remaining < 0n ? '0' : remaining.toString(),
    };
  }
}

export const fileService = new FileService();