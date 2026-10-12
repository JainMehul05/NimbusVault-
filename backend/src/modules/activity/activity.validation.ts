import { z } from 'zod';

export const activityLogQuerySchema = z.object({
  query: z.object({
    userId: z.string().uuid().optional(),
    resourceType: z.enum(['FILE', 'FOLDER', 'SHARE_LINK', 'USER']).optional(),
    resourceId: z.string().uuid().optional(),
    action: z.enum([
      'auth_login',
      'auth_failed_login',
      'auth_logout',
      'auth_password_change',
      'file_upload',
      'file_download',
      'file_delete',
      'file_restore',
      'file_rename',
      'file_move',
      'folder_create',
      'folder_delete',
      'share_create',
      'share_revoke',
      'share_access',
      'ai_query',
    ]).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export const resourceActivitySchema = z.object({
  params: z.object({
    resourceType: z.enum(['FILE', 'FOLDER']),
    resourceId: z.string().uuid(),
  }),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});