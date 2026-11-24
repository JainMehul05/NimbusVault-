import type { File, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import prisma from '@database/prisma';
import { authorizationService } from '@common/authorization';
import { fileNamesLock, lockInTransaction } from '@common/locks';
import { firstFreeName } from '@common/names';
import { releaseQuota, reserveQuota } from './quota.service';

export type FileCategoryName = 'pdf' | 'image' | 'video' | 'document' | 'other';

export interface CreateFileInput {
  filename: string;
  sizeBytes: bigint;
  mimeType: string;
  category: FileCategoryName;
  ownerId: string;
  folderId: string | null;
  s3Key: string;
  checksumSha256: string | null;
  status: 'UPLOADING' | 'READY' | 'FAILED';
  stagingKey?: string;
  uploadExpiresAt?: Date;
}

export interface FileListResult {
  files: Array<
    Pick<
      File,
      'id' | 'filename' | 'sizeBytes' | 'mimeType' | 'category' | 'folderId' | 'status' | 'aiStatus' | 'uploadedAt' | 'deletedAt'
    >
  >;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const ALLOWED_TYPES = new Set([
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
]);

export class FileService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async getCategoryFromMimeType(mimeType: string): Promise<FileCategoryName> {
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
  normalizeMimeType(rawMimeType: string, filename: string): string {
    // Drop parameters such as "; charset=utf-8".
    const mimeType = rawMimeType.split(';')[0].trim().toLowerCase();
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

  async validateFileType(mimeType: string, _filename: string): Promise<FileCategoryName> {
    if (!ALLOWED_TYPES.has(mimeType)) {
      throw AppError.badRequest('Unsupported file type', ErrorCodes.UNSUPPORTED_TYPE, { mimeType });
    }
    return this.getCategoryFromMimeType(mimeType);
  }

  async reserveQuota(userId: string, sizeBytes: bigint, requestId?: string): Promise<void> {
    return reserveQuota(this.prismaClient, userId, sizeBytes, requestId);
  }

  async releaseQuota(userId: string, sizeBytes: bigint): Promise<void> {
    return releaseQuota(this.prismaClient, userId, sizeBytes);
  }

  /**
   * Where an upload may go. Into the caller's own space, or into a folder shared with them as an
   * Editor; in that case the folder's owner owns the file and their quota is charged.
   */
  async resolveUploadTarget(userId: string, folderId: string | null): Promise<{ ownerId: string; folderId: string | null }> {
    if (!folderId) return { ownerId: userId, folderId: null };
    const access = await authorizationService.authorizeFolderAccess({ userId, isAuthenticated: true }, folderId, 'write');
    return { ownerId: access.folder!.ownerId, folderId };
  }

  /** Inserts a file, renaming it ("report (1).pdf") if the name is already used in that folder. */
  async insertWithFreeName(tx: Prisma.TransactionClient, input: CreateFileInput): Promise<File> {
    await lockInTransaction(tx, fileNamesLock(input.ownerId, input.folderId));
    if (input.folderId) {
      // The folder may have been deleted while the bytes were uploading.
      const folder = await tx.folder.findFirst({
        where: { id: input.folderId, ownerId: input.ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!folder) throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
    }
    const filename = await this.freeName(tx, input.ownerId, input.folderId, input.filename);
    return tx.file.create({ data: { ...input, filename } });
  }

  private async freeName(tx: Prisma.TransactionClient, ownerId: string, folderId: string | null, name: string): Promise<string> {
    const taken = await tx.file.findMany({
      where: { ownerId, folderId, deletedAt: null },
      select: { filename: true },
    });
    return firstFreeName(name, new Set(taken.map((f) => f.filename)));
  }

  async createUploadRecord(input: CreateFileInput): Promise<File> {
    return this.prismaClient.$transaction((tx) => this.insertWithFreeName(tx, input));
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
    const { folderId, category, status = 'READY', search, page, limit, sortBy, sortOrder } = options;

    const where: Prisma.FileWhereInput = {
      ownerId: userId,
      deletedAt: null,
      status: status as Prisma.FileWhereInput['status'],
      ...(folderId !== undefined ? { folderId } : {}),
      ...(category ? { category: category as Prisma.FileWhereInput['category'] } : {}),
      // Prisma passes `contains` to ILIKE unescaped, so wildcards typed by the user are escaped.
      ...(search ? { filename: { contains: search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } } : {}),
    };

    const validSortFields = ['filename', 'sizeBytes', 'uploadedAt', 'category'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'uploadedAt';

    const [files, total] = await Promise.all([
      this.prismaClient.file.findMany({
        where,
        // The id tiebreak keeps pages stable when many rows share a value.
        orderBy: [{ [sortField]: sortOrder }, { id: 'asc' }],
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

    return { files, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async assertNameFree(tx: Prisma.TransactionClient, file: File, folderId: string | null, filename: string, message: string) {
    const existing = await tx.file.findFirst({
      where: { ownerId: file.ownerId, folderId, filename, deletedAt: null, NOT: { id: file.id } },
      select: { id: true },
    });
    if (existing) throw AppError.conflict(message, ErrorCodes.NAME_CONFLICT);
  }

  async rename(fileId: string, userId: string, newFilename: string): Promise<{ file: File; oldFilename: string }> {
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'rename');
    const file = access.file!;

    const updated = await this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, fileNamesLock(file.ownerId, file.folderId));
      await this.assertNameFree(tx, file, file.folderId, newFilename, 'A file with this name already exists in the folder');
      return tx.file.update({ where: { id: fileId, deletedAt: null }, data: { filename: newFilename } });
    });

    return { file: updated, oldFilename: file.filename };
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

    const updated = await this.prismaClient.$transaction(async (tx) => {
      await lockInTransaction(tx, fileNamesLock(file.ownerId, newFolderId));
      if (newFolderId !== file.folderId) {
        await this.assertNameFree(tx, file, newFolderId, file.filename, 'A file with this name already exists in the destination folder');
      }
      return tx.file.update({ where: { id: fileId, deletedAt: null }, data: { folderId: newFolderId } });
    });

    return { file: updated, previousFolderId: file.folderId };
  }

  /** Moves a file to the trash (owner only) and returns its storage to the owner's quota. */
  async softDelete(fileId: string, userId: string): Promise<File> {
    const access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'delete');
    const file = access.file!;
    if (file.status === 'UPLOADING') {
      throw AppError.conflict('This upload is still in progress. Cancel it instead.', ErrorCodes.UPLOAD_INCOMPLETE);
    }

    return this.prismaClient.$transaction(async (tx) => {
      // Conditional update makes concurrent deletes idempotent: only one releases quota.
      const { count } = await tx.file.updateMany({ where: { id: fileId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) {
        throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
      }
      await releaseQuota(tx, file.ownerId, file.sizeBytes);
      return tx.file.findUniqueOrThrow({ where: { id: fileId } });
    });
  }

  async getFileForDownload(fileId: string, userId: string): Promise<File> {
    const { file } = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'download');
    if (file!.status !== 'READY') {
      throw AppError.badRequest('File is not ready for download', ErrorCodes.UPLOAD_INCOMPLETE, { status: file!.status });
    }
    return file!;
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
