import type { Request, Response, NextFunction } from 'express';
import type { File } from '@prisma/client';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import { fileService } from './files.service';
import { storageService } from '@common/storage';
import { createRequestLogger } from '@common/logger';
import { authorizationService } from '@common/authorization';
import { activityLogService } from '@modules/activity/activity.service';
import { aiIndexingService } from '@modules/ai/indexing.service';
import type { FileUploadInput, FileListQuery, FileDownloadQuery, FilePresignedUploadInput } from './files.validation';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
  logger: ReturnType<typeof createRequestLogger>;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const serializeFile = (file: File) => ({
  id: file.id,
  filename: file.filename,
  sizeBytes: file.sizeBytes.toString(),
  mimeType: file.mimeType,
  category: file.category,
  folderId: file.folderId,
  status: file.status,
  aiStatus: file.aiStatus,
  uploadedAt: file.uploadedAt,
});

export const filesController = {
  upload: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { folderId } = req.body as FileUploadInput;
    const effectiveFolderId = folderId && folderId.trim() ? folderId : undefined;
    const file = req.file;

    if (!file) {
      throw AppError.badRequest('No file provided');
    }

    const cleanupTemp = async () => {
      if (file.path) await unlink(file.path).catch(() => {});
    };

    if (file.size === 0) {
      await cleanupTemp();
      throw AppError.badRequest('Empty file not allowed');
    }

    if (file.size > MAX_FILE_SIZE) {
      await cleanupTemp();
      throw AppError.badRequest('File size exceeds maximum allowed limit (100MB)', 'FILE_TOO_LARGE', {
        maxSize: MAX_FILE_SIZE,
        receivedSize: file.size,
      });
    }

    // Uploads go into the caller's own folders only (the uploader's quota is charged).
    if (effectiveFolderId) {
      const folder = await fileService.validateFolderOwnership(effectiveFolderId, userId);
      if (!folder) {
        await cleanupTemp();
        throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
      }
    }

    const mimeType = fileService.normalizeMimeType(file.mimetype, file.originalname);
    let category;
    try {
      category = await fileService.validateFileType(mimeType, file.originalname);
    } catch (error) {
      await cleanupTemp();
      throw error;
    }

    try {
      await fileService.reserveQuota(userId, BigInt(file.size), requestId);
    } catch (error) {
      await cleanupTemp();
      throw error;
    }

    // Upload to storage
    let uploadResult;
    try {
      const stream = createReadStream(file.path);
      uploadResult = await storageService.upload(userId, file.originalname, stream, mimeType);
    } catch (storageError) {
      await fileService.releaseQuota(userId, BigInt(file.size));
      log.error({ err: storageError }, 'Storage upload failed');
      throw storageError;
    } finally {
      await cleanupTemp();
    }

    // Create file record; on failure undo both the object and the quota reservation.
    let fileRecord: File;
    try {
      fileRecord = await fileService.createUploadRecord({
        filename: file.originalname,
        sizeBytes: BigInt(file.size),
        mimeType,
        category,
        ownerId: userId,
        folderId: effectiveFolderId || null,
        s3Key: uploadResult.key,
        checksumSha256: uploadResult.checksumSha256,
        status: 'READY',
      });
    } catch (dbError) {
      log.error({ err: dbError, s3Key: uploadResult.key }, 'Database write failed, cleaning up S3 object');
      await storageService.delete(uploadResult.key).catch((cleanupErr) => {
        log.error({ err: cleanupErr, s3Key: uploadResult.key }, 'Failed to clean up S3 object after DB failure');
      });
      await fileService.releaseQuota(userId, BigInt(file.size)).catch(() => {});
      throw dbError;
    }

    await activityLogService.logActivity(userId, 'file_upload', {
      resourceType: 'FILE',
      resourceId: fileRecord.id,
      targetOwnerId: userId,
      ipAddress: req.ip,
      metadata: { filename: fileRecord.filename, sizeBytes: fileRecord.sizeBytes.toString(), folderId: fileRecord.folderId },
      requestId,
    });

    // Queue AI indexing (asynchronous; never fails or delays the upload).
    const aiStatus = await aiIndexingService.onFileUploaded(fileRecord).catch((err) => {
      log.warn({ err: (err as Error).message, fileId: fileRecord.id }, 'Could not queue AI indexing');
      return fileRecord.aiStatus;
    });

    log.info({ fileId: fileRecord.id, size: file.size }, 'File uploaded successfully');

    res.status(201).json(
      successResponse(
        { ...serializeFile({ ...fileRecord, aiStatus }), checksumSha256: fileRecord.checksumSha256 },
        'File uploaded successfully',
        requestId
      )
    );
  }),

  list: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const query = req.query as unknown as FileListQuery;

    const result = await fileService.listFiles(userId, {
      folderId: query.folderId === 'root' ? null : query.folderId || undefined,
      category: query.category,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const safeFiles = result.files.map((file) => ({
      ...file,
      sizeBytes: file.sizeBytes.toString(),
    }));

    res.json(
      successResponse(
        {
          files: safeFiles,
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
        'Files retrieved successfully',
        req.requestId
      )
    );
  }),

  getMetadata: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;

    let access;
    try {
      access = await authorizationService.authorizeFileAccess({ userId, isAuthenticated: true }, fileId, 'read');
    } catch {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }
    const file = access.file!;

    res.json(
      successResponse(
        { ...serializeFile(file), checksumSha256: file.checksumSha256, permission: access.effectiveLevel },
        'File metadata retrieved successfully',
        req.requestId
      )
    );
  }),

  download: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;
    const { inline } = req.query as unknown as FileDownloadQuery;

    const file = await fileService.getFileForDownload(fileId, userId);

    const { url, expiresIn } = await storageService.generatePresignedDownloadUrl(file.s3Key, 3600);

    await activityLogService.logActivity(userId, 'file_download', {
      resourceType: 'FILE',
      resourceId: fileId,
      targetOwnerId: file.ownerId,
      ipAddress: req.ip,
      metadata: { filename: file.filename },
      requestId: req.requestId,
    });

    res.json(
      successResponse(
        {
          downloadUrl: url,
          expiresIn,
          filename: file.filename,
          sizeBytes: file.sizeBytes.toString(),
          mimeType: file.mimeType,
          inline,
        },
        'Download URL generated successfully',
        req.requestId
      )
    );
  }),

  rename: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;
    const { filename } = req.body;

    const { file, oldFilename } = await fileService.rename(fileId, userId, filename);

    if (oldFilename !== file.filename) {
      await activityLogService.logActivity(userId, 'file_rename', {
        resourceType: 'FILE',
        resourceId: fileId,
        targetOwnerId: file.ownerId,
        ipAddress: req.ip,
        metadata: { oldName: oldFilename, newName: file.filename, filename: file.filename },
        requestId: req.requestId,
      });
    }

    res.json(successResponse(serializeFile(file), 'File renamed successfully', req.requestId));
  }),

  move: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;
    const { folderId } = req.body;

    const { file, previousFolderId } = await fileService.move(fileId, userId, folderId || null);

    if (previousFolderId !== file.folderId) {
      await activityLogService.logActivity(userId, 'file_move', {
        resourceType: 'FILE',
        resourceId: fileId,
        targetOwnerId: file.ownerId,
        ipAddress: req.ip,
        metadata: { filename: file.filename, previousFolderId, newFolderId: file.folderId },
        requestId: req.requestId,
      });
    }

    res.json(successResponse(serializeFile(file), 'File moved successfully', req.requestId));
  }),

  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;

    const file = await fileService.softDelete(fileId, userId);

    // Deleted files must disappear from search and Q&A immediately.
    await aiIndexingService.purgeFiles([fileId]);

    await activityLogService.logActivity(userId, 'file_delete', {
      resourceType: 'FILE',
      resourceId: fileId,
      targetOwnerId: file.ownerId,
      ipAddress: req.ip,
      metadata: { filename: file.filename },
      requestId: req.requestId,
    });

    res.json(
      successResponse(
        {
          id: file.id,
          filename: file.filename,
          deletedAt: file.deletedAt,
        },
        'File deleted successfully',
        req.requestId
      )
    );
  }),

  getStorageInfo: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;

    const info = await fileService.getStorageInfo(userId);

    res.json(successResponse(info, 'Storage information retrieved successfully', req.requestId));
  }),

  generatePresignedUploadUrl: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { filename, contentType } = req.body as FilePresignedUploadInput;

    try {
      await fileService.validateFileType(contentType, filename);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.badRequest('Unsupported file type', ErrorCodes.UNSUPPORTED_TYPE, { contentType });
    }

    const result = await storageService.generatePresignedUploadUrl(userId, filename, contentType, 3600);

    res.status(201).json(
      successResponse(
        {
          key: result.key,
          url: result.url,
          expiresIn: result.expiresIn,
        },
        'Presigned upload URL generated successfully',
        req.requestId
      )
    );
  }),
};
