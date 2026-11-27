import type { Request, Response, NextFunction } from 'express';
import type { File } from '@prisma/client';
import { createReadStream } from 'fs';
import { open, unlink } from 'fs/promises';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import { contentProblem, isInlineSafe } from '@common/file-signature';
import { contentDisposition, sanitizeFilename } from '@common/names';
import { storageService } from '@common/storage';
import prisma from '@database/prisma';
import { createRequestLogger } from '@common/logger';
import { authorizationService } from '@common/authorization';
import { activityLogService } from '@modules/activity/activity.service';
import { aiIndexingService } from '@modules/ai/indexing.service';
import { fileService } from './files.service';
import { uploadService } from './uploads.service';
import type { FileUploadInput, FileListQuery, FileDownloadQuery, FilePresignedUploadInput } from './files.validation';
import { assertUploadAllowed } from '@common/public-limits';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
  logger: ReturnType<typeof createRequestLogger>;
}

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

/** Presigned GET that always carries a safe Content-Disposition and the stored type. */
export const presignFileDownload = (
  file: Pick<File, 's3Key' | 'filename' | 'mimeType'>,
  options: { inline?: boolean } = {}
) => {
  const inline = !!options.inline && isInlineSafe(file.mimeType);
  return storageService.generatePresignedDownloadUrl(file.s3Key, undefined, {
    disposition: contentDisposition(inline ? 'inline' : 'attachment', file.filename),
    // Anything a browser might execute is downgraded to an opaque download.
    contentType: file.mimeType === 'image/svg+xml' ? 'application/octet-stream' : file.mimeType,
  });
};

async function readHead(path: string, bytes = 4096): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(bytes), 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Audit entry and AI queueing shared by both upload paths. Neither can fail the upload. */
async function afterUpload(file: File, userId: string, req: Request): Promise<File['aiStatus']> {
  await activityLogService.logActivity(userId, 'file_upload', {
    resourceType: 'FILE',
    resourceId: file.id,
    targetOwnerId: file.ownerId,
    ipAddress: req.ip,
    metadata: { filename: file.filename, sizeBytes: file.sizeBytes.toString(), folderId: file.folderId },
    requestId: req.requestId,
  });
  return aiIndexingService.onFileUploaded(file).catch((err) => {
    createRequestLogger(req.requestId, userId).warn({ err: (err as Error).message, fileId: file.id }, 'Could not queue AI indexing');
    return file.aiStatus;
  });
}

export const filesController = {
  statistics: asyncHandler(async (req: AuthenticatedRequest,res:Response)=>{
    const ownerId=req.user!.userId;
    const [groups,indexedFiles,uploads]=await Promise.all([
      prisma.file.groupBy({by:['category'],where:{ownerId,deletedAt:null,status:'READY'},_count:{_all:true},_sum:{sizeBytes:true}}),
      prisma.file.count({where:{ownerId,deletedAt:null,status:'READY',aiStatus:'INDEXED'}}),
      prisma.$queryRaw<Array<{day:string;count:number;bytes:string}>>`SELECT DATE("uploadedAt")::text AS day,COUNT(*)::int AS count,SUM("sizeBytes")::text AS bytes FROM files WHERE "ownerId"=${ownerId} AND "deletedAt" IS NULL AND status='READY' AND "uploadedAt">=NOW()-INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
    ]);
    res.json(successResponse({indexedFiles,totalFiles:groups.reduce((n,g)=>n+g._count._all,0),totalBytes:groups.reduce((n,g)=>n+(g._sum.sizeBytes||0n),0n).toString(),types:groups.map(g=>({category:g.category,count:g._count._all,bytes:(g._sum.sizeBytes||0n).toString()})),uploads},'Private vault statistics',req.requestId));
  }),
  upload: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { folderId } = req.body as FileUploadInput;
    const file = req.file;

    if (!file) {
      throw AppError.badRequest('No file provided');
    }
    if (file.size === 0) {
      throw AppError.badRequest('Empty file not allowed');
    }

    const filename = sanitizeFilename(file.originalname);
    const target = await fileService.resolveUploadTarget(userId, folderId?.trim() || null);
    const mimeType = fileService.normalizeMimeType(file.mimetype, filename);
    const category = await fileService.validateFileType(mimeType, filename);
    const problem = contentProblem(await readHead(file.path), mimeType);
    if (problem) {
      throw AppError.badRequest(problem, ErrorCodes.UNSUPPORTED_TYPE, { mimeType });
    }

    const size = BigInt(file.size);
    await assertUploadAllowed(target.ownerId, filename, size);
    await fileService.reserveQuota(target.ownerId, size, requestId);

    // Upload to storage
    let uploadResult;
    try {
      uploadResult = await storageService.upload(target.ownerId, filename, createReadStream(file.path), mimeType);
    } catch (storageError) {
      await fileService.releaseQuota(target.ownerId, size);
      log.error({ err: (storageError as Error).message }, 'Storage upload failed');
      throw storageError;
    } finally {
      await unlink(file.path).catch(() => {});
    }

    // Create file record; on failure undo both the object and the quota reservation.
    let fileRecord: File;
    try {
      fileRecord = await fileService.createUploadRecord({
        filename,
        sizeBytes: size,
        mimeType,
        category,
        ownerId: target.ownerId,
        folderId: target.folderId,
        s3Key: uploadResult.key,
        checksumSha256: uploadResult.checksumSha256,
        status: 'READY',
      });
    } catch (dbError) {
      log.error({ err: (dbError as Error).message, s3Key: uploadResult.key }, 'Database write failed, cleaning up S3 object');
      await storageService.delete(uploadResult.key).catch((cleanupErr) => {
        log.error({ err: (cleanupErr as Error).message, s3Key: uploadResult.key }, 'Failed to clean up S3 object after DB failure');
      });
      await fileService.releaseQuota(target.ownerId, size).catch(() => {});
      throw dbError;
    }

    const aiStatus = await afterUpload(fileRecord, userId, req);
    log.info({ fileId: fileRecord.id, size: file.size }, 'File uploaded successfully');

    res.status(201).json(
      successResponse(
        { ...serializeFile({ ...fileRecord, aiStatus }), checksumSha256: fileRecord.checksumSha256 },
        'File uploaded successfully',
        requestId
      )
    );
  }),

  beginPresignedUpload: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const { filename, contentType, sizeBytes, folderId, checksumSha256 } = req.body as FilePresignedUploadInput;
    const result = await uploadService.begin({
      userId: req.user!.userId,
      filename,
      contentType,
      sizeBytes,
      folderId: folderId ?? null,
      checksumSha256,
      requestId: req.requestId,
    });
    res.status(201).json(
      successResponse(
        {
          fileId: result.file.id,
          filename: result.file.filename,
          key: result.key,
          url: result.url,
          method: 'PUT',
          headers: result.headers,
          expiresIn: result.expiresIn,
        },
        'Presigned upload URL generated successfully',
        req.requestId
      )
    );
  }),

  completePresignedUpload: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const { file, alreadyComplete } = await uploadService.complete(req.params.fileId, userId);
    const aiStatus = alreadyComplete ? file.aiStatus : await afterUpload(file, userId, req);
    res.json(
      successResponse(
        { ...serializeFile({ ...file, aiStatus }), checksumSha256: file.checksumSha256 },
        'Upload completed',
        req.requestId
      )
    );
  }),

  abortPresignedUpload: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    await uploadService.abort(req.params.fileId, req.user!.userId);
    res.json(successResponse(null, 'Upload cancelled', req.requestId));
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

    res.json(
      successResponse(
        {
          files: result.files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })),
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
    const access = await authorizationService.authorizeFileAccess(
      { userId: req.user!.userId, isAuthenticated: true },
      req.params.fileId,
      'read'
    );
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
    const { url, expiresIn } = await presignFileDownload(file, { inline });

    await activityLogService.logActivity(userId, 'file_download', {
      resourceType: 'FILE',
      resourceId: fileId,
      targetOwnerId: file.ownerId,
      ipAddress: req.ip,
      metadata: { filename: file.filename },
      requestId: req.requestId,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json(
      successResponse(
        {
          downloadUrl: url,
          expiresIn,
          filename: file.filename,
          sizeBytes: file.sizeBytes.toString(),
          mimeType: file.mimeType,
          inline: inline && isInlineSafe(file.mimeType),
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
};
