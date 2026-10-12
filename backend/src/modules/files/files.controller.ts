import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import { fileService } from './files.service';
import { storageService } from '@common/storage';
import { createRequestLogger } from '@common/logger';
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

    if (file.size === 0) {
      // Clean up empty temp file
      if (file.path) {
        await unlink(file.path).catch(() => {});
      }
      throw AppError.badRequest('Empty file not allowed');
    }

    if (file.size > MAX_FILE_SIZE) {
      // Clean up oversized temp file
      if (file.path) {
        await unlink(file.path).catch(() => {});
      }
      throw AppError.badRequest('File size exceeds maximum allowed limit (100MB)', 'FILE_TOO_LARGE', {
        maxSize: MAX_FILE_SIZE,
        receivedSize: file.size,
      });
    }

    // Validate folder ownership if provided
    if (effectiveFolderId) {
      const folder = await fileService.validateFolderOwnership(effectiveFolderId, userId);
      if (!folder) {
        if (file.path) {
          await unlink(file.path).catch(() => {});
        }
        throw AppError.notFound('Folder not found', ErrorCodes.FOLDER_NOT_FOUND);
      }
    }

    // Validate file type
    const category = await fileService.validateFileType(file.mimetype, file.originalname);

    // Reserve quota
    await fileService.reserveQuota(userId, BigInt(file.size), requestId);

    // Upload to storage
    let uploadResult;
    try {
      const stream = createReadStream(file.path);
      uploadResult = await storageService.upload(userId, file.originalname, stream, file.mimetype);
    } catch (storageError) {
      // Release quota on storage failure
      await fileService.releaseQuota(userId, BigInt(file.size));
      log.error({ err: storageError }, 'Storage upload failed');
      throw storageError;
    } finally {
      // Clean up temp file
      if (file.path) {
        await unlink(file.path).catch((err) => log.warn({ err }, 'Failed to clean up temp file'));
      }
    }

    // Create file record
    let fileRecord;
    try {
      fileRecord = await fileService.createUploadRecord({
        filename: file.originalname,
        sizeBytes: BigInt(file.size),
        mimeType: file.mimetype,
        category,
        ownerId: userId,
        folderId: effectiveFolderId || null,
        s3Key: uploadResult.key,
        checksumSha256: uploadResult.checksumSha256,
        status: 'READY',
      });

      // Update status to READY (already set, but explicit)
      await fileService.finalizeUpload(fileRecord.id, 'READY');
    } catch (dbError) {
      // Clean up S3 object on database failure
      log.error({ err: dbError, s3Key: uploadResult.key }, 'Database write failed, cleaning up S3 object');
      await storageService.delete(uploadResult.key).catch((cleanupErr) => {
        log.error({ err: cleanupErr, s3Key: uploadResult.key }, 'Failed to clean up S3 object after DB failure');
      });
      throw dbError;
    }

    log.info({ fileId: fileRecord.id, s3Key: uploadResult.key, size: file.size }, 'File uploaded successfully');

    res.status(201).json(
      successResponse(
        {
          id: fileRecord.id,
          filename: fileRecord.filename,
          sizeBytes: fileRecord.sizeBytes.toString(),
          mimeType: fileRecord.mimeType,
          category: fileRecord.category,
          folderId: fileRecord.folderId,
          status: fileRecord.status,
          checksumSha256: fileRecord.checksumSha256,
          uploadedAt: fileRecord.uploadedAt,
        },
        'File uploaded successfully',
        requestId
      )
    );
  }),

  list: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const query = req.query as unknown as FileListQuery;

    const result = await fileService.listFiles(userId, {
      folderId: query.folderId || undefined,
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

    const file = await fileService.findById(fileId, userId);
    if (!file) {
      throw AppError.notFound('File not found', ErrorCodes.FILE_NOT_FOUND);
    }

    res.json(
      successResponse(
        {
          id: file.id,
          filename: file.filename,
          sizeBytes: file.sizeBytes.toString(),
          mimeType: file.mimeType,
          category: file.category,
          folderId: file.folderId,
          status: file.status,
          checksumSha256: file.checksumSha256,
          uploadedAt: file.uploadedAt,
        },
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

    // Generate presigned URL for download
    const { url, expiresIn } = await storageService.generatePresignedDownloadUrl(file.s3Key, 3600);

    // Log download activity
    await fileService.getPrismaClient().activityLog.create({
      data: {
        userId,
        action: 'file_download',
        resourceType: 'FILE',
        resourceId: fileId,
        ipAddress: req.ip,
        metadata: { filename: file.filename },
      },
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

    const file = await fileService.rename(fileId, userId, filename);

    // Log rename activity
    await fileService.getPrismaClient().activityLog.create({
      data: {
        userId,
        action: 'file_rename',
        resourceType: 'FILE',
        resourceId: fileId,
        ipAddress: req.ip,
        metadata: { oldName: req.body.oldFilename || 'unknown', newName: filename },
      },
    });

    res.json(
      successResponse(
        {
          id: file.id,
          filename: file.filename,
          sizeBytes: file.sizeBytes.toString(),
          mimeType: file.mimeType,
          category: file.category,
          folderId: file.folderId,
          status: file.status,
          uploadedAt: file.uploadedAt,
        },
        'File renamed successfully',
        req.requestId
      )
    );
  }),

  move: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;
    const { folderId } = req.body;

    const file = await fileService.move(fileId, userId, folderId || null);

    // Log move activity
    await fileService.getPrismaClient().activityLog.create({
      data: {
        userId,
        action: 'file_move',
        resourceType: 'FILE',
        resourceId: fileId,
        ipAddress: req.ip,
        metadata: { newFolderId: folderId || null },
      },
    });

    res.json(
      successResponse(
        {
          id: file.id,
          filename: file.filename,
          sizeBytes: file.sizeBytes.toString(),
          mimeType: file.mimeType,
          category: file.category,
          folderId: file.folderId,
          status: file.status,
          uploadedAt: file.uploadedAt,
        },
        'File moved successfully',
        req.requestId
      )
    );
  }),

  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { fileId } = req.params;

    const file = await fileService.softDelete(fileId, userId);

    // Log delete activity
    await fileService.getPrismaClient().activityLog.create({
      data: {
        userId,
        action: 'file_delete',
        resourceType: 'FILE',
        resourceId: fileId,
        ipAddress: req.ip,
        metadata: { filename: file.filename },
      },
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

    res.json(
      successResponse(
        info,
        'Storage information retrieved successfully',
        req.requestId
      )
    );
  }),

  generatePresignedUploadUrl: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { filename, contentType } = req.body as FilePresignedUploadInput;

    // Validate file type
    try {
      await fileService.validateFileType(contentType, filename);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.badRequest('Unsupported file type', ErrorCodes.UNSUPPORTED_TYPE, { contentType });
    }

    // Generate presigned upload URL
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