import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { sharingService } from './sharing.service';
import { createRequestLogger } from '@common/logger';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
  logger: ReturnType<typeof createRequestLogger>;
}

export const sharingController = {
  createShare: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { resourceType, resourceId, granteeEmail, level } = req.body;


    const result = await sharingService.createOrUpdateShare({
      resourceType,
      resourceId,
      granteeEmail,
      level,
      grantedBy: userId,
      requestId,
    });

    log.info(
      { resourceType, resourceId, granteeId: result.grantee.id, level },
      'Share created/updated successfully'
    );

    res.status(201).json(
      successResponse(
        {
          permission: {
            id: result.permission.id,
            resourceType: result.permission.resourceType,
            resourceId: result.permission.resourceId,
            level: result.permission.level,
            createdAt: result.permission.createdAt,
          },
          grantee: result.grantee,
        },
        result.created ? 'Share permission created' : 'Share permission updated',
        requestId
      )
    );
  }),

  listShares: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { resourceType, resourceId } = req.params;

    const shares = await sharingService.listShares(resourceType as 'FILE' | 'FOLDER', resourceId, userId);

    log.info({ resourceType, resourceId, count: shares.length }, 'Shares listed');

    res.json(
      successResponse(
        {
          shares: shares.map(s => ({
            id: s.id,
            resourceType: s.resourceType,
            resourceId: s.resourceId,
            level: s.level,
            createdAt: s.createdAt,
            grantee: s.grantee,
          })),
        },
        'Shares retrieved successfully',
        requestId
      )
    );
  }),

  updateShare: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { resourceType, resourceId, granteeId } = req.params;
    const { level } = req.body;

    const permission = await sharingService.updateShare(
      resourceType as 'FILE' | 'FOLDER',
      resourceId,
      granteeId,
      level,
      userId,
      requestId
    );

    log.info({ resourceType, resourceId, granteeId, level }, 'Share permission updated');

    res.json(
      successResponse(
        {
          id: permission.id,
          resourceType: permission.resourceType,
          resourceId: permission.resourceId,
          level: permission.level,
          createdAt: permission.createdAt,
        },
        'Share permission updated successfully',
        requestId
      )
    );
  }),

  revokeShare: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { resourceType, resourceId, granteeId } = req.params;

    await sharingService.revokeShare(resourceType as 'FILE' | 'FOLDER', resourceId, granteeId, userId, requestId);

    log.info({ resourceType, resourceId, granteeId }, 'Share permission revoked');

    res.json(
      successResponse(
        null,
        'Share permission revoked successfully',
        requestId
      )
    );
  }),

  getSharedWithMe: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const result = await sharingService.listResourcesSharedWithUser(userId, { page, limit });

    log.info({ userId, fileCount: result.files.length, folderCount: result.folders.length }, 'Shared with me retrieved');

    res.json(
      successResponse(
        {
          // BigInt cannot be JSON-serialized; expose sizes as strings like the files API does.
          files: result.files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })),
          folders: result.folders,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit),
          },
        },
        'Shared resources retrieved successfully',
        requestId
      )
    );
  }),

  getSharedByMe: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const result = await sharingService.listResourcesSharedByUser(userId);

    log.info({ userId, fileCount: result.files.length, folderCount: result.folders.length }, 'Shared by me retrieved');

    res.json(
      successResponse(
        {
          files: result.files,
          folders: result.folders,
        },
        'Shared resources retrieved successfully',
        requestId
      )
    );
  }),
};