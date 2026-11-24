import type { PrismaClient, ActivityLog, ActivityAction, ResourceType, Prisma } from '@prisma/client';
import prisma from '@database/prisma';
import { createRequestLogger, logger } from '@common/logger';
import { authorizationService } from '@common/authorization';

export interface ActivityLogEntry {
  id: bigint;
  userId: string | null;
  targetOwnerId: string | null;
  action: ActivityAction;
  resourceType: ResourceType | null;
  resourceId: string | null;
  ipAddress: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  user?: { id: string; name: string; email: string } | null;
}

/**
 * Filters for the signed-in user's activity feed. There is intentionally no `userId`
 * filter: the feed is always derived from the authenticated identity.
 */
export interface ActivityFeedFilters {
  resourceType?: ResourceType;
  resourceId?: string;
  action?: ActivityAction;
  startDate?: Date;
  endDate?: Date;
  page: number;
  limit: number;
}

export interface ActivityPage {
  entries: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LogActivityOptions {
  resourceType?: ResourceType;
  resourceId?: string;
  /** Owner of the affected resource; lets owners see events caused by others. */
  targetOwnerId?: string | null;
  ipAddress?: string;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

export class ActivityLogService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /**
   * Records an event. Call only after the operation has succeeded. Logging is best-effort:
   * a failure to write the audit row is logged but never turns a completed operation into
   * an error response (which would invite the client to retry and duplicate it).
   */
  async logActivity(userId: string | null, action: ActivityAction, options: LogActivityOptions = {}): Promise<ActivityLog | null> {
    const log = options.requestId ? createRequestLogger(options.requestId) : logger;
    try {
      const entry = await this.prismaClient.activityLog.create({
        data: {
          userId,
          targetOwnerId: options.targetOwnerId ?? null,
          action,
          resourceType: options.resourceType,
          resourceId: options.resourceId,
          ipAddress: options.ipAddress,
          metadata: options.metadata ?? undefined,
        },
      });
      log.debug({ action, resourceType: options.resourceType, resourceId: options.resourceId }, 'Activity logged');
      return entry;
    } catch (err) {
      log.error({ err: (err as Error).message, action }, 'Failed to record activity');
      return null;
    }
  }

  private async page(where: Prisma.ActivityLogWhereInput, page: number, limit: number): Promise<ActivityPage> {
    const [entries, total] = await Promise.all([
      this.prismaClient.activityLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaClient.activityLog.count({ where }),
    ]);
    return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * The requester's feed: events they performed plus events on resources they own
   * (including anonymous share-link visits). Optional filters only ever narrow this scope;
   * they are combined with AND, so no filter can widen it to another user's events.
   */
  async getFeed(requesterId: string, filters: ActivityFeedFilters): Promise<ActivityPage> {
    const { resourceType, resourceId, action, startDate, endDate, page, limit } = filters;
    const where: Prisma.ActivityLogWhereInput = {
      AND: [
        { OR: [{ userId: requesterId }, { targetOwnerId: requesterId }] },
        resourceType ? { resourceType } : {},
        resourceId ? { resourceId } : {},
        action ? { action } : {},
        startDate || endDate ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {},
      ],
    };
    return this.page(where, page, limit);
  }

  /** Events the requester performed themselves. */
  async getUserActivity(userId: string, options: { page: number; limit: number }): Promise<ActivityPage> {
    return this.page({ userId }, options.page, options.limit);
  }

  /**
   * Full history of one file or folder. Requires `view_activity` (owner only) on the resource;
   * throws 404 when the requester cannot see the resource at all.
   */
  async getResourceActivity(
    resourceType: 'FILE' | 'FOLDER',
    resourceId: string,
    requesterId: string,
    options: { page: number; limit: number }
  ): Promise<ActivityPage> {
    const ctx = { userId: requesterId, isAuthenticated: true };
    if (resourceType === 'FILE') {
      await authorizationService.authorizeFileAccess(ctx, resourceId, 'view_activity');
    } else {
      await authorizationService.authorizeFolderAccess(ctx, resourceId, 'view_activity');
    }
    return this.page({ resourceType, resourceId }, options.page, options.limit);
  }
}

/**
 * API shape for an entry. IP addresses are personal data: they are only shown for events the
 * requester performed, never for other users or anonymous visitors.
 */
export function serializeActivityEntry(e: ActivityLogEntry, requesterId: string) {
  return {
    id: e.id.toString(),
    userId: e.userId,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    ipAddress: e.userId === requesterId ? e.ipAddress : null,
    metadata: e.metadata,
    createdAt: e.createdAt,
    user: e.user ?? null,
    performedByYou: e.userId === requesterId,
    anonymous: e.userId === null,
  };
}

export const activityLogService = new ActivityLogService();
