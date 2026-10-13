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
      mimeType.startsWith('application/') &&
      (mimeType.includes('word') ||
        mimeType.includes('excel') ||
        mimeType.includes('powerpoint') ||
        mimeType.includes('msword') ||
        mimeType.includes('vnd.openxmlformats') ||
        mimeType === 'text/plain' ||
        mimeType === 'application/rtf')
    ) {
      return 'document';
    }
    return 'other';
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
      'application/rtf',
    ];

    if (!allowedTypes.includes(mimeType)) {
      throw AppError.badRequest('Unsupported file type', ErrorCodes.UNSUPPORTED_TYPE, { mimeType });
    }

    return this.getCategoryFromMimeType(mimeType);
  }

  async reserveQuota(userId: string, sizeBytes: bigint, requestId?: string): Promise<void> {
    const log = requestId ? createRequestLogger(requestId) : logger;

    // Use a transaction with select-for-update to prevent race conditions
    await this.prismaClient.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { storageQuotaBytes: true, storageUsedBytes: true },
      });

      if (!user) {
        throw AppError.notFound('User not found', ErrorCodes.NOT_OWNER);
      }

      const newUsage = user.storageUsedBytes + sizeBytes;
      if (newUsage > user.storageQuotaBytes) {
        log.warn({ userId, requested: sizeBytes.toString(), quota: user.storageQuotaBytes.toString(), used: user.storageUsedBytes.toString() }, 'Quota exceeded');
        throw AppError.forbidden('Storage quota exceeded', ErrorCodes.QUOTA_EXCEEDED, {
          quota: user.storageQuotaBytes.toString(),
          used: user.storageUsedBytes.toString(),
          requested: sizeBytes.toString(),
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: { storageUsedBytes: newUsage },
      });
    });
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

  async rename(fileId: string, userId: string, newFilename: string): Promise<File> {
    // Check for duplicate name in same folder - use proper authorization for rename action
    const access = await authorizationService.authorizeFileAccess(
      { userId, isAuthenticated: true },
      fileId,
      'rename'
    );
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

    return updatedFile;
  }

  async move(fileId: string, userId: string, newFolderId: string | null): Promise<File> {
    const file = await this.findById(fileId, userId);
    if (!file) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    if (newFolderId !== null) {
      // Validate folder exists and belongs to user
      const folder = await this.prismaClient.folder.findFirst({
        where: {
          id: newFolderId,
          ownerId: userId,
          deletedAt: null,
        },
      });

      if (!folder) {
        throw AppError.notFound('Destination folder not found', ErrorCodes.FOLDER_NOT_FOUND);
      }

      // Check for duplicate name in destination folder
      const existingFile = await this.prismaClient.file.findFirst({
        where: {
          ownerId: userId,
          folderId: newFolderId,
          filename: file.filename,
          deletedAt: null,
        },
      });

      if (existingFile) {
        throw AppError.conflict('A file with this name already exists in the destination folder', ErrorCodes.NAME_CONFLICT);
      }
    }

    const updatedFile = await this.prismaClient.file.update({
      where: { id: fileId },
      data: { folderId: newFolderId },
    });

    return updatedFile;
  }

  async softDelete(fileId: string, userId: string): Promise<File> {
    const file = await this.findById(fileId, userId);
    if (!file) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    // Release quota
    await this.releaseQuota(userId, file.sizeBytes);

    const deletedFile = await this.prismaClient.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
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