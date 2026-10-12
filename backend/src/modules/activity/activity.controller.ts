import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { activityLogService } from './activity.service';
import { createRequestLogger } from '@common/logger';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    type: string;
  };
  logger: ReturnType<typeof createRequestLogger>;
}

export const activityController = {
  getActivityLog: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const query = req.query as any;

    const result = await activityLogService.getActivityLog({
      userId: query.userId || userId, // Users can only see their own activity unless admin
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      action: query.action,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page: parseInt(query.page) || 1,
      limit: parseInt(query.limit) || 20,
    });

    log.info({ userId, total: result.total, page: result.page }, 'Activity log retrieved');

    res.json(
      successResponse(
        {
          entries: result.entries.map(e => ({
            id: e.id.toString(),
            userId: e.userId,
            action: e.action,
            resourceType: e.resourceType,
            resourceId: e.resourceId,
            ipAddress: e.ipAddress,
            metadata: e.metadata,
            createdAt: e.createdAt,
            user: e.user,
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
        'Activity log retrieved successfully',
        requestId
      )
    );
  }),

  getResourceActivity: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const { resourceType, resourceId } = req.params;
    const query = req.query as any;

    const result = await activityLogService.getResourceActivity(
      resourceType as 'FILE' | 'FOLDER',
      resourceId,
      userId,
      {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 20,
        requestId,
      }
    );

    log.info({ userId, resourceType, resourceId, total: result.total }, 'Resource activity retrieved');

    res.json(
      successResponse(
        {
          entries: result.entries.map(e => ({
            id: e.id.toString(),
            userId: e.userId,
            action: e.action,
            resourceType: e.resourceType,
            resourceId: e.resourceId,
            ipAddress: e.ipAddress,
            metadata: e.metadata,
            createdAt: e.createdAt,
            user: e.user,
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
        'Resource activity retrieved successfully',
        requestId
      )
    );
  }),

  getMyActivity: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const userId = req.user!.userId;
    const requestId = req.requestId;
    const log = createRequestLogger(requestId, userId);
    req.logger = log;

    const query = req.query as any;

    const result = await activityLogService.getUserActivity(userId, {
      page: parseInt(query.page) || 1,
      limit: parseInt(query.limit) || 20,
      requestId,
    });

    log.info({ userId, total: result.total, page: result.page }, 'User activity retrieved');

    res.json(
      successResponse(
        {
          entries: result.entries.map(e => ({
            id: e.id.toString(),
            userId: e.userId,
            action: e.action,
            resourceType: e.resourceType,
            resourceId: e.resourceId,
            ipAddress: e.ipAddress,
            metadata: e.metadata,
            createdAt: e.createdAt,
            user: e.user,
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
        'Activity log retrieved successfully',
        requestId
      )
    );
  }),
};