import type { Request, Response, NextFunction } from 'express';
import type { ActivityAction, ResourceType } from '@prisma/client';
import { asyncHandler } from '@common/async-handler';
import { successResponse } from '@common/response';
import { activityLogService, serializeActivityEntry, type ActivityPage } from './activity.service';
import type { ActivityLogQuery, ResourceActivityQuery } from './activity.validation';

interface AuthenticatedRequest extends Request {
  user?: { userId: string; email: string; type: string };
}

const toBody = (result: ActivityPage, requesterId: string) => ({
  entries: result.entries.map((e) => serializeActivityEntry(e, requesterId)),
  pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages },
});

export const activityController = {
  /**
   * GET /activity — the caller's own feed. Scope always comes from the access token. A
   * `userId` query parameter (accepted by older clients) is rejected by validation unless it
   * equals the caller, so it can never be used to read another user's history.
   */
  getActivityLog: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const requesterId = req.user!.userId;
    const query = req.query as unknown as ActivityLogQuery;

    if (query.userId && query.userId !== requesterId) {
      return res.status(403).json({
        success: false,
        message: 'You can only view your own activity',
        error: { code: 'FORBIDDEN' },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      });
    }

    const result = await activityLogService.getFeed(requesterId, {
      resourceType: query.resourceType as ResourceType | undefined,
      resourceId: query.resourceId,
      action: query.action as ActivityAction | undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page: query.page,
      limit: query.limit,
    });

    res.json(successResponse(toBody(result, requesterId), 'Activity log retrieved successfully', req.requestId));
  }),

  getResourceActivity: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const requesterId = req.user!.userId;
    const { resourceType, resourceId } = req.params as { resourceType: 'FILE' | 'FOLDER'; resourceId: string };
    const query = req.query as unknown as ResourceActivityQuery;

    const result = await activityLogService.getResourceActivity(resourceType, resourceId, requesterId, {
      page: query.page,
      limit: query.limit,
    });

    res.json(successResponse(toBody(result, requesterId), 'Resource activity retrieved successfully', req.requestId));
  }),

  getMyActivity: asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const requesterId = req.user!.userId;
    const query = req.query as unknown as ResourceActivityQuery;
    const result = await activityLogService.getUserActivity(requesterId, { page: query.page, limit: query.limit });
    res.json(successResponse(toBody(result, requesterId), 'Activity log retrieved successfully', req.requestId));
  }),
};
