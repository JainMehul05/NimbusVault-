import { z } from 'zod';
import { ActivityAction } from '@prisma/client';

const pagination = {
  page: z.coerce.number().int().positive().max(100000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};

export const activityLogQuerySchema = z.object({
  query: z
    .object({
      // Legacy parameter. Only the caller's own id is honoured (checked in the controller).
      userId: z.string().uuid().optional(),
      resourceType: z.enum(['FILE', 'FOLDER', 'SHARE_LINK', 'USER']).optional(),
      resourceId: z.string().uuid().optional(),
      action: z.nativeEnum(ActivityAction).optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      ...pagination,
    })
    .refine((q) => !q.startDate || !q.endDate || q.startDate <= q.endDate, {
      message: 'startDate must be before endDate',
      path: ['startDate'],
    }),
});

export const myActivitySchema = z.object({
  query: z.object(pagination),
});

export const resourceActivitySchema = z.object({
  params: z.object({
    resourceType: z.enum(['FILE', 'FOLDER']),
    resourceId: z.string().uuid(),
  }),
  query: z.object(pagination),
});

export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>['query'];
export type ResourceActivityQuery = z.infer<typeof myActivitySchema>['query'];
