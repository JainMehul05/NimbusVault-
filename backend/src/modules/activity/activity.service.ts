import type { PrismaClient, ActivityLog, ActivityAction, ResourceType } from '@prisma/client';
import prisma from '@database/prisma';
import { createRequestLogger } from '@common/logger';

export interface ActivityLogEntry {
  id: bigint;
  userId: string | null;
  action: ActivityAction;
  resourceType: ResourceType | null;
  resourceId: string | null;
  ipAddress: string | null;
  metadata: any;
  createdAt: Date;
  user?: { id: string; name: string; email: string } | null;
}

export interface ActivityLogFilters {
  userId?: string;
  resourceType?: ResourceType;
  resourceId?: string;
  action?: ActivityAction;
  startDate?: Date;
  endDate?: Date;
  page: number;
  limit: number;
}

export class ActivityLogService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async logActivity(
    userId: string | null,
    action: ActivityAction,
    options: {
      resourceType?: ResourceType;
      resourceId?: string;
      ipAddress?: string;
      metadata?: any;
      requestId?: string;
    } = {}
  ): Promise<ActivityLog> {
    const log = options.requestId ? createRequestLogger(options.requestId) : undefined;

    const entry = await this.prismaClient.activityLog.create({
      data: {
        userId,
        action,
        resourceType: options.resourceType,
        resourceId: options.resourceId,
        ipAddress: options.ipAddress,
        metadata: options.metadata ?? null,
      },
    });

    log?.info(
      { userId, action, resourceType: options.resourceType, resourceId: options.resourceId },
      'Activity logged'
    );

    return entry;
  }

  async getActivityLog(
    filters: ActivityLogFilters
  ): Promise<{ entries: ActivityLogEntry[]; total: number; page: number; limit: number; totalPages: number }> {
    const { userId, resourceType, resourceId, action, startDate, endDate, page, limit } = filters;

    const where: any = {};

    if (userId) where.userId = userId;
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;
    if (action) where.action = action;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [entries, total] = await Promise.all([
      this.prismaClient.activityLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaClient.activityLog.count({ where }),
    ]);

    return {
      entries: entries.map(e => ({
        ...e,
        user: e.user,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getResourceActivity(
    resourceType: ResourceType,
    resourceId: string,
    userId: string,
    options: { page: number; limit: number; requestId?: string } = { page: 1, limit: 20 }
  ): Promise<{ entries: ActivityLogEntry[]; total: number; page: number; limit: number; totalPages: number }> {
    // Verify user has access to this resource
    const { authorizationService } = await import('@common/authorization');
    await authorizationService.getFileAccess(userId, resourceId); // This will throw if no access

    const { entries, total, page, limit, totalPages } = await this.getActivityLog({
      resourceType,
      resourceId,
      page: options.page,
      limit: options.limit,
    });

    return { entries, total, page, limit, totalPages };
  }

  async getUserActivity(
    userId: string,
    options: { page: number; limit: number; requestId?: string } = { page: 1, limit: 20 }
  ): Promise<{ entries: ActivityLogEntry[]; total: number; page: number; limit: number; totalPages: number }> {
    const { entries, total, page, limit, totalPages } = await this.getActivityLog({
      userId,
      page: options.page,
      limit: options.limit,
    });

    return { entries, total, page, limit, totalPages };
  }
}

export const activityLogService = new ActivityLogService();