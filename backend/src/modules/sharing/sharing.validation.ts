import { z } from 'zod';

export const resourceTypeSchema = z.enum(['FILE', 'FOLDER']);

export const permissionLevelSchema = z.enum(['VIEWER', 'EDITOR']);

export const sharePermissionSchema = z.enum(['VIEW', 'DOWNLOAD']);

export const createShareSchema = z.object({
  body: z.object({
    resourceType: resourceTypeSchema,
    resourceId: z.string().uuid(),
    granteeEmail: z.string().email(),
    level: permissionLevelSchema,
  }),
});

export const updateShareSchema = z.object({
  params: z.object({
    resourceType: resourceTypeSchema,
    resourceId: z.string().uuid(),
    granteeId: z.string().uuid(),
  }),
  body: z.object({
    level: permissionLevelSchema,
  }),
});

export const revokeShareSchema = z.object({
  params: z.object({
    resourceType: resourceTypeSchema,
    resourceId: z.string().uuid(),
    granteeId: z.string().uuid(),
  }),
});

export const listSharesSchema = z.object({
  params: z.object({
    resourceType: resourceTypeSchema,
    resourceId: z.string().uuid(),
  }),
});

export const sharedWithMeSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export const sharedByMeSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});